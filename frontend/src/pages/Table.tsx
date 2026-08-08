import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Volume2, Settings2, Wifi, WifiOff, MessageSquare } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { PokerTable } from '@/components/poker/PokerTable';
import { ActionBar } from '@/components/poker/ActionBar';
import { InsurancePrompt } from '@/components/poker/InsurancePrompt';
import { JackpotBurst } from '@/components/poker/JackpotBurst';
import { toast } from '@/lib/toast';
import { chips } from '@/lib/money';
import { useTranslation } from 'react-i18next';
import { BuyInSheet } from '@/components/poker/BuyInSheet';
import { TableDesignSheet } from '@/components/poker/TableDesignSheet';
import { Button } from '@/components/ui/Button';
import { GAMES } from '@/lib/games';
import { LIVE_TABLE_IDS } from '@/config';
import { useDemoHand } from '@/hooks/useDemoHand';
import { useLiveTable } from '@/hooks/useLiveTable';
import { ChatBox } from '@/components/poker/ChatBox';
import { useTableChat } from '@/hooks/useTableChat';
import { ChallengeModal } from '@/components/poker/ChallengeModal';

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
  const tableId = id && LIVE_TABLE_IDS.has(id) ? id : null;

  if (!tableId) return <NoTableYet gameId={id} />;
  return params.get('demo') === '1' ? <DemoTable /> : <LiveTable tableId={tableId} />;
}

// ── The real thing ────────────────────────────────────────────────────────────

function LiveTable({ tableId }: { tableId: string }) {
  const navigate = useNavigate();
  const live = useLiveTable(tableId);
  const { snapshot, view, status, error, signedIn, signingIn } = live;

  /** Buy-in sheet target: a seat index to sit in, `null` to top up, `false` when closed. */
  const { t } = useTranslation();
  const [buyInFor, setBuyInFor] = useState<number | null | false>(false);
  const [designsOpen, setDesignsOpen] = useState(false);
  // Cleared when the hand id changes, so declining one hand's offer does not
  // suppress the next hand's.
  const [insuranceDeclined, setInsuranceDeclined] = useState<string | null>(null);
  // Which hit this viewer has already watched — so a snapshot refetch does not
  // replay the celebration.
  const [jackpotSeen, setJackpotSeen] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [challengePrompt, setChallengePrompt] = useState<string | null>(null);

  const { messages, sendChat } = useTableChat(live.socket);

  // Hook into socket events to show challenge modal
  useEffect(() => {
    const socket = live.socket;
    if (!socket) return;

    const handleEvent = (data: any) => {
      setChallengePrompt(data.challengerId);
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
  const playersReady = snapshot?.seats.filter((s) => s.status !== 'sittingout').length ?? 0;

  return (
    <div
      className="flex min-h-full flex-col"
      style={{ background: 'radial-gradient(ellipse at top, #14142a 0%, var(--bg) 70%)' }}
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

      <div className="flex flex-1 items-center px-3 relative">
        <PokerTable
          state={view}
          {...(seated ? {} : { onSit: (seatIndex: number): void => setBuyInFor(seatIndex) })}
          onChallenge={(playerId) => live.challenge(playerId)}
        />
        
        {/* Floating Chat Toggle Button */}
        <button
          onClick={() => setChatOpen((o) => !o)}
          className={`absolute bottom-[4.5rem] right-4 grid size-12 place-items-center rounded-full shadow-2xl border border-border transition-colors z-50 ${
            chatOpen ? 'bg-brand text-brand-fg' : 'bg-surface text-dim hover:text-text'
          }`}
        >
          <MessageSquare size={20} />
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
                  disabled={status !== 'ready' || live.watching}
                  placeholder={live.watching ? "Spectators cannot chat" : "Say something..."}
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Result banner */}
      <AnimatePresence>
        {view.handOver && view.message && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mx-auto mb-2 rounded-full px-4 py-1.5 text-sm font-semibold text-white shadow-lg"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          >
            {view.message}
          </motion.div>
        )}
      </AnimatePresence>

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

      {/* Insurance. Rendered purely on the offer's presence: the server sends
          one only to the two all-in players, so "3+ silently skips" needs no
          rule here. Declining just clears it locally — the next snapshot will
          not carry an offer once the street moves on. */}
      <InsurancePrompt
        quote={insuranceDeclined === snapshot?.handId ? null : (snapshot?.insurance ?? null)}
        seconds={snapshot?.insurance?.expiresInSeconds ?? 10}
        onAccept={() => {
          // TODO: send a takeInsurance command once the room accepts one. The
          // quote is server-issued, so the client sends intent, never a price.
          setInsuranceDeclined(snapshot?.handId ?? null);
          toast.success(t('insurance.taken'));
        }}
        onDecline={() => setInsuranceDeclined(snapshot?.handId ?? null)}
      />

      {/* Action dock */}
      <div className="border-t border-border bg-surface/80 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 backdrop-blur">
        {live.heroToAct ? (
          <ActionBar state={view} onAction={live.heroAct} />
        ) : seated ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 text-[0.8rem] text-dim">
              {statusLine(t, snapshot?.phase, playersReady, mySeat?.status === 'sittingout')}
            </div>
            {mySeat && mySeat.stack === 0 ? (
              <Button size="sm" onClick={() => setBuyInFor(null)}>
                Rebuy
              </Button>
            ) : mySeat?.status === 'sittingout' ? (
              <Button size="sm" onClick={live.sitIn}>
                Sit in
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={live.sitOut}>
                Sit out
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={live.stand}>
              Leave
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
  t: (key: string) => string,
  phase: string | undefined,
  playersReady: number,
  sittingOut: boolean,
): string {
  if (sittingOut) return t('table.sittingOut');
  if (phase === 'DEALING') return t('table.dealing');
  if (phase === 'SHOWDOWN') return t('table.nextHand');
  if (phase === 'IN_HAND') return t('table.waitingPlayers');
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
      style={{ background: 'radial-gradient(ellipse at top, #14142a 0%, var(--bg) 70%)' }}
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

        <button className="grid size-9 place-items-center rounded-full border border-border bg-surface text-dim active:scale-95">
          <Volume2 size={16} />
        </button>
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
      style={{ background: 'radial-gradient(ellipse at top, #14142a 0%, var(--bg) 70%)' }}
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
      style={{ background: 'radial-gradient(ellipse at top, #14142a 0%, var(--bg) 70%)' }}
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
      style={{ background: 'radial-gradient(ellipse at top, #14142a 0%, var(--bg) 70%)' }}
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

      <AnimatePresence>
        {view.handOver && view.message && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mx-auto mb-2 rounded-full px-4 py-1.5 text-sm font-semibold text-white shadow-lg"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          >
            {view.message}
          </motion.div>
        )}
      </AnimatePresence>

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
