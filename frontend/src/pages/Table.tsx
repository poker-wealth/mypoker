import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Menu, Wifi, WifiOff, MessageSquare, List as ListIcon, Spade, Mic } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { PokerTable } from '@/components/poker/PokerTable';
import { ActionBar } from '@/components/poker/ActionBar';
import { TimeBank } from '@/components/poker/TimeBank';
import { InsurancePrompt } from '@/components/poker/InsurancePrompt';
import { JackpotBurst } from '@/components/poker/JackpotBurst';
import { chips } from '@/lib/money';
import { useTranslation } from 'react-i18next';
import { BuyInSheet } from '@/components/poker/BuyInSheet';
import { TableDesignSheet } from '@/components/poker/TableDesignSheet';
import { TableMenu } from '@/components/poker/TableMenu';
import { HandRankings } from '@/components/poker/HandRankings';
import { PlayerListPanel } from '@/components/poker/PlayerListPanel';
import { PlayerProfileCard } from '@/components/poker/PlayerProfileCard';
import { TableSettingsSheet } from '@/components/poker/TableSettingsSheet';
import { toast } from '@/lib/toast';
import { inviteUrl } from '@/lib/tableInvite';
import { TELEGRAM_BOT_NAME } from '@/config';
import { Button } from '@/components/ui/Button';
import { GAMES } from '@/lib/games';
import { isOpenableTableId } from '@/config';
import { useDemoHand } from '@/hooks/useDemoHand';
import { useLiveTable } from '@/hooks/useLiveTable';
import type { TableSnapshot } from '@/lib/liveTable';
import { designForGame, groundFor } from '@/lib/tableDesigns';
import { useTableDesign } from '@/store/tableDesign';
import { cn } from '@/lib/cn';
import { useSoundSetting } from '@/hooks/useSoundSetting';
import { play } from '@/lib/sound';
import { ChatBox } from '@/components/poker/ChatBox';
import { useTableChat } from '@/hooks/useTableChat';
import { ChallengeModal } from '@/components/poker/ChallengeModal';
import { unlockTableApi } from '@/api/tables';

import { feltFor } from '@/components/games/registry';

/**
 * The table screen.
 *
 * By default it plays a REAL hand: seats, chips and cards come from the game server over the secure
 * socket, and the people in the other chairs are other people. `?demo=1` still runs the offline
 * browser engine, so the screen can always be shown with no backend running.
 *
 * This screen is Texas Hold'em ONLY. The lobby lists games whose screens don't exist yet (Baccarat,
 * Niu Niu, Dou Di Zhu, Red Packet), and every route used to fall through to the Hold'em felt — so
 * tapping Baccarat dealt you poker. Anything without a table of its own now says so plainly.
 */
export function Table() {
  const [params] = useSearchParams();
  const { id } = useParams();
  const tableId = isOpenableTableId(id) ? id : null;

  if (!tableId) return <NoTableYet gameId={id} />;
  if (params.get('demo') === '1') return <DemoTable />;
  return (
    <PrivateTableGate tableId={tableId} code={params.get('code')}>
      <LiveTable tableId={tableId} />
    </PrivateTableGate>
  );
}

// ── The real thing ────────────────────────────────────────────────────────────

/**
 * Redeem a private table's invite code before the socket opens.
 *
 * A private table refuses anyone who has not presented its code, on every
 * inbound socket message — so this has to finish BEFORE `useLiveTable` connects,
 * or the first `join` is refused and the player sees an error on a table they
 * were invited to.
 *
 * It always falls through to the table once the attempt settles, whatever the
 * outcome. That is deliberate: the socket is the authority, and a gate that
 * blocked on its own failure would become a second, weaker place to be refused
 * — including for a table this registry never heard of (the fixed lobby tables
 * answer "unknown", which is not a reason to hide a public felt). If the code
 * really was wrong, the rail says so in its own words.
 *
 * The ref is not decoration. TRAPS §14: a guard on react state is a render
 * behind, and this must fire once — a second attempt spends one of the ten
 * tries the server allows per player before it stops listening.
 */
function PrivateTableGate({
  tableId,
  code,
  children,
}: {
  tableId: string;
  code: string | null;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const fired = useRef(false);
  const [settled, setSettled] = useState(!code);

  useEffect(() => {
    if (!code || fired.current) return;
    fired.current = true;
    void unlockTableApi(tableId, code)
      .catch(() => {
        // Swallowed on purpose — see the note above. The socket refuses if this
        // mattered, with a message about the code rather than about the network.
      })
      .finally(() => setSettled(true));
  }, [tableId, code]);

  if (!settled) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-[0.8rem] text-dim">
        {t('table.unlocking')}
      </div>
    );
  }
  return <>{children}</>;
}

function LiveTable({ tableId }: { tableId: string }) {
  const navigate = useNavigate();
  const live = useLiveTable(tableId);
  const { snapshot, view, status, error, signedIn, signingIn } = live;
  // Mirrors the player's Settings toggle into the sound engine for as long as
  // the table is open. Cues elsewhere just call play() and stay ignorant of it.
  useSoundSetting();
  // The player picks the colour; the game picks the shape.
  const chosenDesign = useTableDesign((s) => s.design);

  /**
   * Your turn, out loud.
   *
   * The status line answers "whose turn is it" for anyone watching the screen.
   * This answers it for the player who has to act and may not be — a Mini App
   * spends most of its life behind another window, and a turn missed in silence
   * is a hand folded by the clock.
   *
   * Latched rather than fired on every render: the ref clears only when the turn
   * passes, so a re-render mid-turn cannot chime twice.
   */
  const yourTurn =
    snapshot?.phase === 'IN_HAND' &&
    snapshot.seats.some((s) => s.isYou && s.index === snapshot.toActSeat);
  const announcedTurn = useRef(false);
  useEffect(() => {
    if (!yourTurn) {
      announcedTurn.current = false;
      return;
    }
    if (announcedTurn.current) return;
    announcedTurn.current = true;
    play('turn');
  }, [yourTurn]);

  /**
   * A new hand is being dealt — one cue for everyone at the table.
   *
   * Keyed on the hand NUMBER rather than the phase: a snapshot refetch can
   * repeat a phase, and re-dealing the same hand audibly is how a table starts
   * sounding broken. Skips the very first snapshot, which would otherwise
   * deal-sound at whatever hand happened to be in progress when you sat down.
   */
  const handNumber = snapshot?.handNumber ?? 0;
  const lastDealt = useRef<number | null>(null);
  useEffect(() => {
    if (handNumber <= 0) return;
    if (lastDealt.current === null) {
      lastDealt.current = handNumber;
      return;
    }
    if (handNumber === lastDealt.current) return;
    lastDealt.current = handNumber;
    play('deal');
  }, [handNumber]);

  /**
   * Everyone's actions, heard as they land.
   *
   * Driven off each seat's `lastAction`, which the server sets and clears — so
   * this reacts to what the table actually did rather than to what this client
   * sent, and a remote player's raise sounds the same as your own. The map
   * remembers what was already voiced per seat, so a re-render or a refetch
   * that carries the same action does not replay it.
   */
  const voicedActions = useRef(new Map<number, string>());
  useEffect(() => {
    if (!snapshot) return;
    for (const seat of snapshot.seats) {
      const action = seat.lastAction;
      if (!action || typeof action === 'string') continue;
      // Include the amount so a call of 20 and a later call of 60 are
      // different events rather than one repeated 'call'.
      const stamp = `${snapshot.handNumber}:${action.kind}:${action.amount ?? ''}`;
      if (voicedActions.current.get(seat.index) === stamp) continue;
      voicedActions.current.set(seat.index, stamp);
      if (action.kind === 'fold') play('fold');
      else if (action.kind === 'check') play('check');
      else play('chip'); // call, raise, all-in — all of them move chips
    }
  }, [snapshot]);

  /** Buy-in sheet target: a seat index to sit in, `null` to top up, `false` when closed. */
  const { t } = useTranslation();
  const [buyInFor, setBuyInFor] = useState<number | null | false>(false);
  const [designsOpen, setDesignsOpen] = useState(false);
  // Which hit this viewer has already watched — so a snapshot refetch does not
  // replay the celebration.
  const [jackpotSeen, setJackpotSeen] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rankingsOpen, setRankingsOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  /** Whose card is open, by playerId. The seat is looked up fresh each render
   *  so the figures on it track the table rather than freezing at open time. */
  const [profileFor, setProfileFor] = useState<string | null>(null);

  /**
   * Copy this table's invite link.
   *
   * The SAME link the create dialog hands out — `inviteUrl`, the Telegram deep
   * link — not `window.location.href`. A web URL pasted into Telegram opens the
   * phone's browser, where the recipient meets a sign-in page instead of the
   * table they were invited to.
   *
   * The private join code is not carried here: this is shared from inside a
   * table by anyone sitting at it, including someone who was let in by a
   * creator who may not want the code passed on. The creator's own dialog is
   * where the code-bearing link comes from.
   */
  const shareInvite = (): void => {
    if (!tableId) return;
    const url = inviteUrl({ tableId }, TELEGRAM_BOT_NAME);
    void navigator.clipboard
      ?.writeText(url)
      .then(() => toast.success(t('tableEntry.copied')))
      .catch(() => {
        // Clipboard can be unavailable in a locked-down WebView. A failed copy
        // is a nuisance, not a dead end — say so rather than failing silently.
        toast.error(t('states.error'));
      });
  };
  const [challengePrompt, setChallengePrompt] = useState<string | null>(null);

  const { messages, sendChat, sendVoice, unread, markRead } = useTableChat(
    live.socket,
    snapshot?.you?.playerId,
  );

  // Opening the drawer IS reading them. Also clears while it stays open, so
  // messages arriving as you watch do not queue up a count behind the panel.
  useEffect(() => {
    if (chatOpen) markRead();
  }, [chatOpen, messages.length, markRead]);

  // Hook into socket events to show challenge modal
  useEffect(() => {
    const socket = live.socket;
    if (!socket) return;

    const handleEvent = (data: unknown) => {
      setChallengePrompt((data as { challengerId: string }).challengerId);
    };

    socket.on('prompt_challenge', handleEvent);

    return () => {
      socket.off('prompt_challenge', handleEvent);
    };
  }, [live.socket]);

  // Sign-in is attempted on arrival; only offer the prompt once it has actually failed.
  if (!signedIn) {
    return signingIn ? (
      <SigningIn onBack={() => navigate(-1)} />
    ) : (
      <SignedOut onBack={() => navigate(-1)} />
    );
  }

  const seated = snapshot?.yourSeat != null;
  const mySeat = snapshot?.seats.find((s) => s.isYou);
  // The game owns the felt where it has an opinion — Short Deck is a different
  // table, not a skin. Games without one leave the player's choice alone.
  const gameDesign = designForGame(tableId, snapshot?.variant, chosenDesign);
  const playersReady = snapshot?.seats.filter((s) => s.status !== 'sittingout').length ?? 0;
  // By table id for the fixed tables; by the snapshot's game for created
  // `t-…` ones — without the fallback a player-created baccarat table dealt
  // community cards on the poker felt.
  const Felt = feltFor(tableId) ?? (snapshot?.game ? feltFor(snapshot.game) : undefined);

  return (
    /* THE GROUND IS THE WHOLE SCREEN, not a box in the middle of a black one.
       This was hardcoded #000, so the chosen colour was painted only inside
       the felt aspect box and everything around it — top bar, dock, footer —
       stayed black. The reference is one continuous surface with the controls
       sitting directly on it. */
    <div
      className="flex min-h-full flex-col"
      style={{ background: groundFor(chosenDesign) }}
    >
      <TopBar
        subtitle={
          snapshot
            ? `${snapshot.name} · Hand ${view.handId} · Blinds ${chips(snapshot.smallBlind)}/${chips(snapshot.bigBlind)}`
            : t('table.connecting')
        }
        onBack={() => navigate(-1)}
        status={status}
        onOpenMenu={() => setMenuOpen(true)}
      />

      {/*
        The table menu. Wired to what exists and nothing else.

        `onStandUp` is the `stand` command — give up the seat, keep watching —
        and is DELIBERATELY not `sitOut`, which keeps your seat and skips hands.
        Confusing the two would take a player's seat away when they meant to sit
        out a hand, at a table they might not be able to rejoin.

        `onRankings` is omitted because the chart does not exist yet; the row
        disables itself with a reason rather than opening nothing.

        `onExit` leaves the screen. It does NOT stand first — leaving the page
        while seated is the same as closing the app, and the server's own
        disconnect handling owns a seat's fate from there. Standing on the way
        out would forfeit a seat the player may be about to return to.
      */}
      <TableMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onShare={shareInvite}
        {...(seated
          ? {
              onStandUp: () => live.command({ kind: 'stand' }),
              // The table's own buy-in sheet, for this seat — not a second
              // implementation of buying in.
              onBuyIn: () => setBuyInFor(snapshot?.yourSeat ?? null),
              onSitOut: () => live.command({ kind: 'sitOut' }),
            }
          : {})}
        onRankings={() => setRankingsOpen(true)}
        onOptions={() => setDesignsOpen(true)}
        onExit={() => navigate(-1)}
      />

      <PlayerListPanel
        open={playersOpen}
        onClose={() => setPlayersOpen(false)}
        seats={snapshot?.seats ?? []}
        tableId={tableId}
        onPlayer={(playerId) => setProfileFor(playerId)}
        {...(snapshot?.spectators !== undefined ? { spectators: snapshot.spectators } : {})}
        {...(snapshot?.openedAt !== undefined ? { openedAt: snapshot.openedAt } : {})}
      />

      <PlayerProfileCard
        seat={snapshot?.seats.find((s) => s.playerId === profileFor) ?? null}
        onClose={() => setProfileFor(null)}
      />

      <HandRankings
        open={rankingsOpen}
        onClose={() => setRankingsOpen(false)}
        {...(snapshot?.game ? { game: snapshot.game } : {})}
      />

      {/* A wide felt loses more to gutters than a tall one — it is short enough
          that width is the only dimension it is starved of. The chat button is
          absolutely positioned and unaffected by dropping the padding. */}
      <div className={cn('relative flex flex-1 items-center', gameDesign ? 'px-0' : 'px-3')}>
        {Felt ? (
          <Felt snapshot={snapshot} onCommand={(cmd) => live.command(cmd)} />
        ) : (
          <PokerTable
            state={view}
            {...(snapshot
              ? {
                  info: {
                    name: snapshot.name,
                    tableId: snapshot.tableId,
                    smallBlind: snapshot.smallBlind,
                    bigBlind: snapshot.bigBlind,
                  },
                }
              : {})}
            // The game brings its own felt where it has one — Short Deck is a
            // different table, not a skin of Hold'em — and that wins over the
            // picker. Games with no felt of their own leave the choice alone.
            {...(gameDesign ? { design: gameDesign } : {})}
            {...(seated ? {} : { onSit: (seatIndex: number): void => setBuyInFor(seatIndex) })}
            onChallenge={(playerId) => live.challenge(playerId)}
          />
        )}
        
        {/* Chat Drawer Overlay */}
        <AnimatePresence>
          {chatOpen && (
            <>
              {/* Click-away backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setChatOpen(false)}
                className="absolute inset-0 z-30 bg-black/20"
              />
              {/* Drawer */}
              <motion.div
                initial={{ x: '100%', opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '100%', opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="absolute top-0 right-0 bottom-0 w-72 z-40 shadow-2xl overflow-hidden border-l border-border bg-surface/95 backdrop-blur-md"
              >
                <ChatBox
                  messages={messages}
                  onSend={sendChat}
                  // Spectators cannot chat (§10.1) and so cannot voice either —
                  // withholding the button matches what the server would refuse.
                  {...(live.watching ? {} : { onSendVoice: sendVoice })}
                  // Still gated while watching, because the SERVER refuses a
                  // spectator's message (`SPECTATORS_CANNOT_CHAT`) — an open
                  // box that swallows what you type and answers "Chat denied"
                  // is worse than one that says so first. But the reason is on
                  // screen now, with what to do about it: take a seat.
                  disabled={status !== 'ready' || live.watching}
                  placeholder={live.watching ? t('table.chatTakeSeat') : t('table.chatSay')}
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Result banner */}
      {/* The result now renders under the board, inside PokerTable — it belongs
          next to the cards it is describing, not down here with the controls. */}

      {error && (
        <div className="mx-auto mb-2 rounded-full border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] px-3 py-1 text-[0.72rem] font-semibold text-danger">
          {error}
        </div>
      )}

      {/* Jackpot celebration — fires only for a hit the ledger has already
          PAID (the room refuses to announce anything transfer() rejected). */}
      <JackpotBurst
        win={
          jackpotSeen === snapshot?.jackpot?.roundId
            ? null
            : (snapshot?.jackpot ?? null)
        }
        onDone={() => setJackpotSeen(snapshot?.jackpot?.roundId ?? null)}
      />

      {/* Insurance is deferred to a later milestone: the accept path (a takeInsurance
          command + the Financial Core premium/payout movement) isn't built yet, so we
          do NOT surface an offer we can't honour — showing "insured" without taking a
          premium would be a lie about money. Re-enable by passing the real quote once
          the room accepts an insurance command. */}
      <InsurancePrompt
        quote={null}
        seconds={snapshot?.insurance?.expiresInSeconds ?? 10}
        onAccept={() => {}}
        onDecline={() => {}}
      />

      {/* Action dock */}
      <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
        {live.heroToAct ? (
          <>
            {/* Above the buttons, and only while it is your turn — an opponent's
                remaining reserve is not yours to see. */}
            <TimeBank
              timeBankMs={snapshot?.timeBankMs ?? 0}
              usingTimeBank={snapshot?.usingTimeBank ?? false}
              autoTimeBank={snapshot?.autoTimeBank ?? false}
              deadline={snapshot?.actionDeadline ?? null}
              onUse={() => live.command({ kind: 'useTimeBank' })}
              onToggleAuto={(on) => live.command({ kind: 'autoTimeBank', on })}
            />
            <ActionBar state={view} onAction={live.heroAct} />
          </>
        ) : snapshot?.awaitingStart ? (
          // A manual-start table ("auto-start: None"): the owner gets the
          // button; everyone else gets told what the wait is.
          <div className="flex items-center gap-2">
            <div className="flex-1 text-[0.8rem] text-dim">
              {snapshot.isOwner ? t('table.startWhenReady') : t('table.waitingOwner')}
            </div>
            {snapshot.isOwner && (
              <button
                type="button"
                disabled={playersReady < 2}
                onClick={() => live.command({ kind: 'start_game' })}
                className="rounded-(--radius-app) bg-gold px-6 py-2 text-sm font-bold text-bg transition active:scale-[0.98] disabled:opacity-50"
              >
                {t('table.startGame')}
              </button>
            )}
          </div>
        ) : seated ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 text-[0.8rem] text-dim">
              {statusLine(t, snapshot, playersReady, mySeat?.status === 'sittingout')}
            </div>
            {/* All four of these were hardcoded English while `table.rebuy`,
                `table.sitIn`, `table.sitOut` and `table.leave` sat translated
                in all eight locale files — mobile has used them since it was
                built (mobile/src/screens/TableScreen.tsx). So a Thai or
                Japanese player got their own language everywhere on this
                screen except the four controls that take their money off the
                table. Same shape as the Login screen, which had a complete
                translated `auth.*` block that nothing called. */}
            {mySeat && mySeat.stack === 0 ? (
              <Button size="sm" onClick={() => setBuyInFor(null)}>
                {t('table.rebuy')}
              </Button>
            ) : mySeat?.status === 'sittingout' ? (
              <Button size="sm" onClick={live.sitIn}>
                {t('table.sitIn')}
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={live.sitOut}>
                {t('table.sitOut')}
              </Button>
            )}
            {/* The only control that actually vacates the seat. `leave` (back
                button, unmount) merely unsubscribes — the server keeps the seat
                on purpose so a blip cannot cost a stack mid-hand — so without
                this a player who backs out is refused at every other table with
                no way to free themselves (docs/TRAPS.md #12). It exists here;
                it is `stand`, labelled "Leave". */}
            <Button size="sm" variant="ghost" onClick={live.stand}>
              {t('table.leave')}
            </Button>
          </div>
        ) : status === 'error' || status === 'closed' ? (
          <div className="flex items-center gap-2 py-1">
            <div className="flex-1 text-[0.78rem] leading-tight text-danger">
              {error ?? t('table.connectionLost')}
            </div>
            <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="py-3 text-center text-sm text-dim">
            {status === 'ready'
              ? t('table.tapOpenSeat')
              : status === 'reconnecting'
                ? t('table.reconnecting')
                : t('table.connectingTable')}
          </div>
        )}

        {/* The reference app's bottom toolbar: table options, fairness, voice,
            chat. Every icon does something real — the mic and the bubble both
            reach the chat drawer, where the recorder lives. */}
        <div className="mt-1 flex items-center justify-between pt-1.5">
          {/* The list icon opens the PLAYER LIST, as in the reference — it
              used to open the settings sheet, which the menu drawer's Options
              row already reaches. Two ways to the same sheet left the one
              thing the icon looks like it does with no way in at all. */}
          <ToolbarIcon label={t('table.playerList')} onClick={() => setPlayersOpen(true)}>
            <ListIcon size={19} />
          </ToolbarIcon>
          <ToolbarIcon label={t('table.fairness')} onClick={() => navigate('/fairness')}>
            <Spade size={19} />
          </ToolbarIcon>
          <ToolbarIcon label={t('table.voice')} onClick={() => setChatOpen(true)}>
            <Mic size={19} />
          </ToolbarIcon>
          <ToolbarIcon
            label={unread > 0 ? t('table.chatUnread', { count: unread }) : t('table.chat')}
            onClick={() => setChatOpen((o) => !o)}
          >
            <MessageSquare size={19} />
            {/* Unread count — the drawer is closed by default, so without the
                badge a player could be spoken to all session and never know. */}
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 grid min-w-[1.05rem] place-items-center rounded-full bg-danger px-1 text-[0.58rem] font-black leading-[1.05rem] text-white ring-2 ring-bg">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </ToolbarIcon>
        </div>
      </div>

      <BuyInSheet
        open={buyInFor !== false}
        onClose={() => setBuyInFor(false)}
        tableName={snapshot?.name ?? ''}
        smallBlind={snapshot?.smallBlind ?? 10}
        min={snapshot?.minBuyIn ?? 0}
        max={snapshot?.maxBuyIn ?? 0}
        bigBlind={snapshot?.bigBlind ?? 20}
        available={live.available}
        seatIndex={typeof buyInFor === 'number' ? buyInFor : null}
        onConfirm={(amount) => {
          if (typeof buyInFor === 'number') live.sit(buyInFor, amount);
          else live.topUp(amount);
          setBuyInFor(false);
        }}
      />

      <ChallengeModal 
        open={!!challengePrompt} 
        challengerId={challengePrompt ?? ''}
        onAnswer={(passed, ms) => {
          live.answerChallenge(passed, ms);
          setChallengePrompt(null);
        }}
      />

      <TableSettingsSheet
        open={designsOpen}
        onClose={() => setDesignsOpen(false)}
        tableId={tableId}
        isOwner={Boolean(snapshot?.isOwner)}
        seats={(snapshot?.seats ?? []).map((s) => ({
          playerId: s.playerId,
          name: s.name,
          isYou: Boolean(s.isYou),
        }))}
        canStart={Boolean(snapshot?.awaitingStart)}
        onStart={() => live.command({ kind: 'start_game' })}
        onKick={(playerId) => live.command({ kind: 'kick', targetId: playerId })}
        paused={Boolean(snapshot?.paused)}
        closing={Boolean(snapshot?.closing)}
        onPause={(next) => live.command({ kind: 'pause', paused: next })}
        onCloseTable={() => live.command({ kind: 'close_table' })}
      />
    </div>
  );
}

/** Takes `t` rather than calling a hook: this is module scope, outside React. */
function statusLine(
  t: (key: string, opts?: Record<string, unknown>) => string,
  snapshot: TableSnapshot | null | undefined,
  playersReady: number,
  sittingOut: boolean,
): string {
  if (sittingOut) return t('table.sittingOut');
  const phase = snapshot?.phase;
  if (phase === 'DEALING') return t('table.dealing');
  if (phase === 'SHOWDOWN') return t('table.nextHand');

  // DURING a hand, name whose turn it is.
  //
  // This used to read "Waiting for other players…" for the whole hand, which is
  // both wrong and the opposite of useful: it says the table is short of people
  // while the table is busy playing. Two seats is enough to deal (readySeats()
  // < 2 is the only gate), so it was also telling a full heads-up table it was
  // waiting for someone who was never coming.
  //
  // The seat ring already marks who is on the clock, but a ring on a phone-sized
  // felt is easy to miss. Saying the name in the one line everybody reads is the
  // difference between knowing whose turn it is and guessing.
  if (phase === 'IN_HAND') {
    const seat = snapshot?.seats.find((s) => s.index === snapshot.toActSeat);
    if (!seat) return t('table.handInPlay');
    return seat.isYou ? t('table.yourTurn') : t('table.playerTurn', { name: seat.name });
  }

  return playersReady < 2 ? t('table.waitingOne') : t('table.nextHand');
}

/**
 * A game with no table behind it yet. Only Texas Hold'em is playable; the rest of the catalogue is
 * still tiles. Better to say so than to open a poker felt under a Baccarat heading.
 */
/** One icon of the bottom toolbar — a plain tap target with room for a badge. */
function ToolbarIcon({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="relative grid h-10 flex-1 place-items-center text-dim transition-colors active:text-text"
    >
      {children}
    </button>
  );
}

function NoTableYet({ gameId }: { gameId: string | undefined }) {
  const navigate = useNavigate();
  const game = GAMES.find((g) => g.id === gameId);

  return (
    <div
      className="flex min-h-full flex-col"
      style={{ background: '#000' }}
    >
      <TopBar subtitle={game?.name ?? 'Game'} onBack={() => navigate(-1)} />
      <div className="mx-auto w-full max-w-sm flex-1 px-6 pt-20 text-center">
        {game && (
          <div
            className="mx-auto grid size-16 place-items-center rounded-2xl text-3xl"
            style={{ backgroundImage: `linear-gradient(135deg, ${game.gradient[0]}, ${game.gradient[1]})` }}
          >
            {game.glyph}
          </div>
        )}
        <h2 className="mt-5 text-lg font-bold">{game?.name ?? 'This game'} isn’t ready yet</h2>
        <p className="mt-2 text-sm text-dim">
          Texas Hold’em is the only table you can sit at right now. This one is still being built.
        </p>
        <Button full className="mt-6" onClick={() => navigate('/table/texas')}>
          Play Texas Hold’em
        </Button>
        <button
          onClick={() => navigate(-1)}
          className="mt-3 w-full py-2 text-sm text-dim underline-offset-4 hover:underline"
        >
          Back to the lobby
        </button>
      </div>
    </div>
  );
}

// ── Chrome ────────────────────────────────────────────────────────────────────

function TopBar({
  subtitle,
  onBack,
  status,
  onOpenMenu,
}: {
  subtitle: string;
  onBack: () => void;
  status?: string;
  /** Opens the table menu drawer. */
  onOpenMenu?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex gap-2">
        <button
          onClick={onBack}
          className="grid size-9 place-items-center rounded-full border border-border bg-surface active:scale-95"
        >
          <ChevronLeft size={18} />
        </button>
        {/* The menu, top-left beside Back, where the reference app puts it. */}
        {onOpenMenu && (
          <button
            onClick={onOpenMenu}
            aria-label={t('table.menuTitle')}
            className="grid size-9 place-items-center rounded-full border border-border bg-surface active:scale-95"
          >
            <Menu size={18} />
          </button>
        )}
      </div>
      <div className="text-center">
        <div className="text-[0.66rem] text-dim">{subtitle}</div>
      </div>
      <div className="flex gap-2">
        {status && (
          <div
            className="grid size-9 place-items-center rounded-full border border-border bg-surface"
            title={status}
          >
            {status === 'ready' ? (
              <Wifi size={15} className="text-success" />
            ) : (
              <WifiOff size={15} className="text-danger" />
            )}
          </div>
        )}

        {/* The sound toggle and the design button used to sit here. Both are
            reachable from the menu drawer now — Options opens the design
            picker, and sound is a setting rather than something you reach for
            mid-hand. Two buttons doing what one menu row does is clutter on a
            bar that has to share a phone's width with the table's name. */}
      </div>
    </div>
  );
}

/** Sign-in is in flight. Brief, but on a cold open it's the first thing on screen. */
function SigningIn({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex min-h-full flex-col"
      style={{ background: '#000' }}
    >
      <TopBar subtitle={t('table.livePoker')} onBack={onBack} />
      <div className="flex flex-1 items-center justify-center text-sm text-dim">{t('table.signingIn')}</div>
    </div>
  );
}

/**
 * Sign-in was attempted and there's still nobody signed in — outside Telegram with no dev bypass,
 * or it failed. Identity isn't the table's job, so it points at the app's sign-in and gets out of
 * the way.
 */
function SignedOut({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div
      className="flex min-h-full flex-col"
      style={{ background: '#000' }}
    >
      <TopBar subtitle={t('table.livePoker')} onBack={onBack} />
      <div className="mx-auto w-full max-w-sm flex-1 px-6 pt-16 text-center">
        <h2 className="text-lg font-bold">{t('table.signInToSit')}</h2>
        <p className="mt-2 text-sm text-dim">
          Live tables seat real players, so the table needs to know who you are before it can deal
          you in.
        </p>
        <Button full className="mt-6" onClick={() => navigate('/profile')}>
          Go to sign in
        </Button>
        <button
          onClick={() => navigate('?demo=1', { replace: true })}
          className="mt-3 w-full py-2 text-sm text-dim underline-offset-4 hover:underline"
        >
          Watch the demo table instead
        </button>
      </div>
    </div>
  );
}

// ── The offline demo (?demo=1) ────────────────────────────────────────────────

function DemoTable() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const game = GAMES.find((g) => g.id === id);
  const { view, heroAct, heroToAct } = useDemoHand();
  const [designsOpen, setDesignsOpen] = useState(false);

  return (
    <div
      className="flex min-h-full flex-col"
      style={{ background: '#000' }}
    >
      <TopBar
        subtitle={t('table.demoSubtitle', {
          game: game ? t(`gameNames.${game.id}`, { defaultValue: game.name }) : t('gameNames.texas'),
          hand: view.handId,
          blinds: `${chips(10)}/${chips(20)}`,
        })}
        onBack={() => navigate(-1)}
      />

      <div className="flex flex-1 items-center px-3">
        <PokerTable state={view} />
      </div>

      {/* The result now renders under the board, inside PokerTable — it belongs
          next to the cards it is describing, not down here with the controls. */}

      <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
        {heroToAct ? (
          <ActionBar state={view} onAction={heroAct} />
        ) : (
          <div className="py-3 text-center text-sm text-dim">
            {view.handOver ? t('table.nextHand') : t('table.waitingPlayers')}
          </div>
        )}
      </div>

      <TableDesignSheet open={designsOpen} onClose={() => setDesignsOpen(false)} />
    </div>
  );
}

/**
 * The table's sound control.
 *
 * It used to be a Volume2 icon with no handler at all — a button that looked
 * like a mute toggle and did nothing whichever way you tapped it.
 *
 * It now drives the SAME account setting the Settings screen shows, rather
 * than a second piece of local state: muting at the table and finding sound
 * still on in Settings would be worse than the dead button was. The setting is
 * persisted server-side, so it follows the player across devices.
 *
 * The icon reflects the real value, so it is honest even before any audio
 * exists — and once the sound layer lands (blocked on licensing, SAMUEL.md
 * task 2), this already governs it with nothing more to wire.
 */
