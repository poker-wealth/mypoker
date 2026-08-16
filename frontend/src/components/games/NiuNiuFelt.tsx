import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { PlayingCard } from '@/components/poker/PlayingCard';
import type { LiveSeat, TableCommand, TableSnapshot } from '@/lib/liveTable';
import { ringFor, type SeatPos } from '@/lib/tableDesigns';
import { useTableDesign } from '@/store/tableDesign';

/**
 * NIU NIU (BULL BULL).
 *
 * The table is the one the player chose — the same artwork, proportions and measured seat ring the
 * Hold'em felt uses, so a design carries across every game instead of each felt inventing its own.
 * Each chair shows its five cards and the multiplier it is playing at; the clock runs in the middle.
 *
 * The round has two stages and the controls follow `snapshot.stage`:
 *   BIDDING  — bid 1×, 2× or 5× for the bank. The highest bid takes the chair, and that bid
 *              multiplies every settlement of the round.
 *   BETTING  — everyone else stakes against the banker, at their own 1× / 2× / 5×.
 *
 * The server decides all of it. Nothing here computes a stack, a payout or a winner — the felt
 * draws what arrived and sends back which button was pressed.
 */

/** Mirrors `NiuNiuRoundState` in game-server/src/live/niu-niu-room.ts. */
interface NiuNiuRoundState {
  bankerMultiplier: number;
  seats: Array<{ index: number; bid?: number; betMultiplier?: number; hand?: string; net?: number }>;
}

export interface NiuNiuFeltProps {
  snapshot?: TableSnapshot | null;
  onCommand?: (cmd: TableCommand) => void;
}

const CHIPS = [50, 100, 500, 1_000];
const BANK_BIDS = [1, 2, 5];
const STAKE_MULTIPLIERS = [1, 2, 5];

/** Seconds left on the round clock, or null when nothing is running. */
function useCountdown(
  deadline: number | null | undefined,
  serverTime: number | undefined,
): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (!deadline) return null;
  // The clock that matters is the server's; correct for however far off this browser is.
  const skew = serverTime ? serverTime - now : 0;
  const left = Math.ceil((deadline - (now + skew)) / 1_000);
  return left > 0 ? left : 0;
}

export function NiuNiuFelt({ snapshot, onCommand }: NiuNiuFeltProps) {
  const design = useTableDesign((d) => d.design);
  const [betAmount, setBetAmount] = useState(100);
  const [multiplier, setMultiplier] = useState(1);

  const phase = snapshot?.phase ?? 'WAITING';
  const stage = snapshot?.stage;
  const seats = snapshot?.seats ?? [];
  const round = snapshot?.gameState as NiuNiuRoundState | undefined;
  const you = seats.find((s) => s.isYou);
  const isSeated = Boolean(you);
  const youAreBanker = Boolean(you?.isDealer);
  const secondsLeft = useCountdown(snapshot?.actionDeadline, snapshot?.serverTime);

  /** Chairs measured off THIS design's artwork, so a seat lands on its rail and not in the felt. */
  const ring = ringFor(design, Math.max(2, snapshot?.maxSeats ?? 6));

  const stateOf = (index: number) => round?.seats.find((s) => s.index === index);
  const youBid = you ? stateOf(you.index)?.bid : undefined;

  /** Occupied chairs, rotated so the viewer is on the near edge. */
  const occupied = seats.filter((s) => s.playerId);
  const yourPlace = you ? occupied.findIndex((s) => s.index === you.index) : -1;
  const ordered =
    yourPlace > 0 ? [...occupied.slice(yourPlace), ...occupied.slice(0, yourPlace)] : occupied;

  /** Take the first free chair, at the table's own minimum — seat 0 is usually already taken. */
  const sitDown = (): void => {
    const free = seats.find((s) => !s.playerId);
    onCommand?.({ kind: 'sit', seat: free?.index ?? 0, buyIn: snapshot?.minBuyIn ?? 1_000 });
  };

  const bid = (n: number): void => onCommand?.({ kind: 'act', action: { type: `bid-${n}` } });
  const placeBet = (): void =>
    onCommand?.({ kind: 'act', action: { type: 'bet', amount: betAmount, multiplier } });

  const centreLabel =
    phase === 'SHOWDOWN'
      ? 'Showdown'
      : stage === 'BIDDING'
        ? 'Bidding for the bank'
        : stage === 'BETTING'
          ? 'Place your bets'
          : 'Waiting';

  return (
    <div className="mx-auto flex w-full max-w-[440px] flex-col items-center px-5 text-white select-none">
      <div className="relative w-full" style={{ aspectRatio: design.aspect }}>
        {/* The table surface, exactly as the Hold'em felt draws it. */}
        {design.artUrl ? (
          <img
            src={design.artUrl}
            alt=""
            aria-hidden
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-contain"
          />
        ) : (
          <div className="absolute inset-0 rounded-[50%] border-8 border-black/70 bg-[radial-gradient(ellipse_at_center,#0c7a4a_0%,#04301e_100%)]" />
        )}

        {/* The middle of the felt: the clock, and what the table is waiting for. */}
        <div
          className="absolute left-1/2 z-10 flex w-full -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 px-8 text-center"
          style={{ top: design.boardTop }}
        >
          {secondsLeft !== null && phase === 'IN_HAND' && (
            <div
              className="grid h-16 w-16 place-items-center rounded-full border-4 bg-black/45 text-2xl font-black shadow-lg"
              style={{ borderColor: design.accent, color: design.accent }}
            >
              {secondsLeft}
            </div>
          )}

          <div className="rounded-full bg-black/55 px-4 py-1 text-xs font-bold tracking-wide backdrop-blur-sm">
            {centreLabel}
          </div>

          {round && round.bankerMultiplier > 1 && (
            <div
              className="rounded-full bg-black/45 px-3 py-0.5 text-[0.65rem] font-black tracking-widest"
              style={{ color: design.accent }}
            >
              BANK PAYS {round.bankerMultiplier}×
            </div>
          )}

          {phase === 'WAITING' && snapshot?.message && (
            <div className="text-[0.7rem] text-white/70">{snapshot.message}</div>
          )}
        </div>

        {/* Seats, on the rail */}
        {ordered.map((seat, place) => (
          <SeatSpot
            key={seat.index}
            seat={seat}
            slot={ring[place % ring.length]!}
            info={stateOf(seat.index)}
            bankMultiplier={round?.bankerMultiplier ?? 1}
            accent={design.accent}
          />
        ))}
      </div>

      {/* Controls, under the table */}
      <div className="flex w-full flex-col items-center gap-2 py-3">
        {!isSeated ? (
          <Button variant="primary" size="sm" onClick={sitDown}>
            Sit to Play Niu Niu
          </Button>
        ) : stage === 'BIDDING' ? (
          <>
            <span className="rounded-full bg-black/45 px-3 py-1 text-center text-[0.7rem] text-white/80">
              {youBid === undefined
                ? 'Bid for the bank — the highest bid takes it, and multiplies the whole round'
                : `You bid ${youBid}× — waiting for the table`}
            </span>
            <div className="flex items-center gap-2">
              {BANK_BIDS.map((n) => (
                <Button
                  key={n}
                  variant={youBid === n ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => bid(n)}
                >
                  Bid {n}×
                </Button>
              ))}
            </div>
          </>
        ) : stage === 'BETTING' && !youAreBanker ? (
          <>
            <div className="flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5">
              {CHIPS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setBetAmount(amt)}
                  className={`grid h-9 w-9 place-items-center rounded-full text-[0.65rem] font-black transition ${
                    betAmount === amt ? 'bg-amber-400 text-black ring-2 ring-amber-200' : 'bg-white/10 text-white/80'
                  }`}
                >
                  {amt}
                </button>
              ))}
              <span className="mx-1 text-white/25">|</span>
              {STAKE_MULTIPLIERS.map((m) => (
                <button
                  key={m}
                  onClick={() => setMultiplier(m)}
                  className={`rounded-full px-3 py-1 text-xs font-black transition ${
                    multiplier === m ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/80'
                  }`}
                >
                  {m}×
                </button>
              ))}
            </div>
            <Button variant="primary" size="sm" onClick={placeBet} disabled={(you?.bet ?? 0) > 0}>
              {(you?.bet ?? 0) > 0
                ? `Staked ₮${you?.bet}`
                : `Stake ₮${betAmount * multiplier} (₮${betAmount} × ${multiplier})`}
            </Button>
          </>
        ) : (
          <span className="rounded-full bg-black/45 px-3 py-1 text-center text-[0.7rem] text-white/80">
            {youAreBanker
              ? 'You hold the bank — waiting on the bets'
              : (snapshot?.message ?? 'Waiting for the next round')}
          </span>
        )}
      </div>
    </div>
  );
}

interface SeatSpotProps {
  seat: LiveSeat;
  slot: SeatPos;
  info: NiuNiuRoundState['seats'][number] | undefined;
  bankMultiplier: number;
  accent: string;
}

/** One chair: their five cards, nameplate and stack, and what they are playing at. */
function SeatSpot({ seat, slot, info, bankMultiplier, accent }: SeatSpotProps) {
  const badge = seat.isDealer
    ? `${bankMultiplier}×`
    : info?.betMultiplier
      ? `${info.betMultiplier}×`
      : info?.bid
        ? `bid ${info.bid}×`
        : null;

  return (
    <div
      className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
      style={{ left: slot.left, top: slot.top }}
    >
      <div className="relative flex flex-col items-center gap-0.5">
        {seat.cards.length > 0 && (
          <div className="flex gap-0.5">
            {seat.cards.map((card, i) => (
              <PlayingCard key={i} card={card} size="sm" index={i} />
            ))}
          </div>
        )}

        {info?.hand && (
          <div
            className="rounded bg-black/70 px-1.5 text-[0.6rem] font-black tracking-wide"
            style={{ color: accent }}
          >
            {info.hand}
          </div>
        )}

        <div
          className="min-w-20 rounded-lg border bg-black/60 px-2 py-0.5 text-center backdrop-blur-sm"
          style={{ borderColor: seat.isDealer ? accent : 'rgba(255,255,255,0.15)' }}
        >
          <div className="truncate text-[0.7rem] font-bold">{seat.name}</div>
          <div className="text-[0.65rem] text-white/70">₮{seat.stack}</div>
          {seat.isDealer && (
            <div className="text-[0.55rem] font-black tracking-wider" style={{ color: accent }}>
              👑 BANKER
            </div>
          )}
          {seat.bet > 0 && <div className="text-[0.6rem] text-white/70">bet ₮{seat.bet}</div>}
          {info?.net !== undefined && info.net !== 0 && (
            <div
              className={`text-[0.65rem] font-black ${info.net > 0 ? 'text-emerald-400' : 'text-rose-400'}`}
            >
              {info.net > 0 ? '+' : ''}
              {info.net}
            </div>
          )}
        </div>

        {badge && (
          <div className="absolute -top-1.5 -right-2 rounded-full bg-amber-400 px-1.5 text-[0.6rem] font-black text-black shadow">
            {badge}
          </div>
        )}
      </div>
    </div>
  );
}
