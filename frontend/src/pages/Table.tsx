import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Volume2, VolumeX, Settings2, Wifi, WifiOff, MessageSquare } from 'lucide-react';
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
import { Button } from '@/components/ui/Button';
import { GAMES } from '@/lib/games';
import { isOpenableTableId } from '@/config';
import { useDemoHand } from '@/hooks/useDemoHand';
import { useLiveTable } from '@/hooks/useLiveTable';
import type { TableSnapshot } from '@/lib/liveTable';
import { designForGame } from '@/lib/tableDesigns';
import { useTableDesign } from '@/store/tableDesign';
import { cn } from '@/lib/cn';
import { useSoundSetting } from '@/hooks/useSoundSetting';
import { play } from '@/lib/sound';
import { ChatBox } from '@/components/poker/ChatBox';
import { useTableChat } from '@/hooks/useTableChat';
import { useSettings, useUpdateSettings } from '@/api/hooks';
import { haptic } from '@/lib/telegram';
import { ChallengeModal } from '@/components/poker/ChallengeModal';

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
  return params.get('demo') === '1' ? <DemoTable /> : <LiveTable tableId={tableId} />;
}

// ── The real thing ────────────────────────────────────────────────────────────

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

  /** Buy-in sheet target: a seat index to sit in, `null` to top up, `false` when closed. */
  const { t } = useTranslation();
  const [buyInFor, setBuyInFor] = useState<number | null | false>(false);
  const [designsOpen, setDesignsOpen] = useState(false);
  // Which hit this viewer has already watched — so a snapshot refetch does not
  // replay the celebration.
  const [jackpotSeen, setJackpotSeen] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
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
  const Felt = feltFor(tableId);

  return (
    <div
      className="flex min-h-full flex-col"
      style={{ background: '#000' }}
    >
      <TopBar
        subtitle={
          snapshot
            ? `${snapshot.name} · Hand ${view.handId} · Blinds ${chips(snapshot.smallBlind)}/${chips(snapshot.bigBlind)}`
            : t('table.connecting')
        }
        onBack={() => navigate(-1)}
        status={status}
        onOpenDesigns={() => setDesignsOpen(true)}
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
            // The game brings its own felt where it has one — Short Deck is a
            // different table, not a skin of Hold'em — and that wins over the
            // picker. Games with no felt of their own leave the choice alone.
            {...(gameDesign ? { design: gameDesign } : {})}
            {...(seated ? {} : { onSit: (seatIndex: number): void => setBuyInFor(seatIndex) })}
            onChallenge={(playerId) => live.challenge(playerId)}
          />
        )}
        
        {/* Floating Chat Toggle Button */}
        <button
          onClick={() => setChatOpen((o) => !o)}
          aria-label={unread > 0 ? t('table.chatUnread', { count: unread }) : t('table.chat')}
          className={`absolute bottom-[4.5rem] right-4 grid size-12 place-items-center rounded-full shadow-2xl border border-border transition-colors z-50 ${
            chatOpen ? 'bg-brand text-brand-fg' : 'bg-surface text-dim hover:text-text'
          }`}
        >
          <MessageSquare size={20} />
          {/* Unread count. Without it an incoming message was invisible — the
              drawer is closed by default, so a player could be spoken to all
              session and never know. Capped at 9+ so the badge stays a dot-sized
              thing on the rim rather than growing into the button. */}
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-[1.15rem] place-items-center rounded-full bg-danger px-1 text-[0.62rem] font-black leading-[1.15rem] text-white shadow-lg ring-2 ring-bg">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

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
                  disabled={status !== 'ready' || live.watching}
                  placeholder={live.watching ? "Spectators cannot chat" : "Say something..."}
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
      <div className="border-t border-border bg-surface/80 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 backdrop-blur">
        {live.heroToAct ? (
          <>
            {/* Above the buttons, and only while it is your turn — an opponent's
                remaining reserve is not yours to see. */}
            <TimeBank
              timeBankMs={snapshot?.timeBankMs ?? 0}
              usingTimeBank={snapshot?.usingTimeBank ?? false}
              autoTimeBank={snapshot?.autoTimeBank ?? false}
              onUse={() => live.command({ kind: 'useTimeBank' })}
              onToggleAuto={(on) => live.command({ kind: 'autoTimeBank', on })}
            />
            <ActionBar state={view} onAction={live.heroAct} />
          </>
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
      </div>

      <BuyInSheet
        open={buyInFor !== false}
        onClose={() => setBuyInFor(false)}
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

      <TableDesignSheet open={designsOpen} onClose={() => setDesignsOpen(false)} />
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
  onOpenDesigns,
}: {
  subtitle: string;
  onBack: () => void;
  status?: string;
  /** Opens the table-design picker. */
  onOpenDesigns?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <button
        onClick={onBack}
        className="grid size-9 place-items-center rounded-full border border-border bg-surface active:scale-95"
      >
        <ChevronLeft size={18} />
      </button>
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

        <SoundToggle />
        <button
          onClick={onOpenDesigns}
          title={t('table.tableDesign')}
          className="grid size-9 place-items-center rounded-full border border-border bg-surface text-dim active:scale-95"
        >
          <Settings2 size={16} />
        </button>
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
        onOpenDesigns={() => setDesignsOpen(true)}
      />

      <div className="flex flex-1 items-center px-3">
        <PokerTable state={view} />
      </div>

      {/* The result now renders under the board, inside PokerTable — it belongs
          next to the cards it is describing, not down here with the controls. */}

      <div className="border-t border-border bg-surface/80 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 backdrop-blur">
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
function SoundToggle() {
  const { t } = useTranslation();
  const settings = useSettings();
  const update = useUpdateSettings();

  // Hidden rather than shown inert while unknown: a mute button whose state is
  // a guess is the problem this is fixing.
  if (!settings.isSuccess) return null;

  const on = settings.data.sound;

  return (
    <button
      onClick={() => {
        haptic('light');
        update.mutate({ sound: !on });
      }}
      disabled={update.isPending}
      aria-pressed={on}
      title={on ? t('settings.soundOn') : t('settings.soundOff')}
      className="grid size-9 place-items-center rounded-full border border-border bg-surface text-dim active:scale-95 disabled:opacity-60"
    >
      {on ? <Volume2 size={16} /> : <VolumeX size={16} className="text-dim/60" />}
    </button>
  );
}
