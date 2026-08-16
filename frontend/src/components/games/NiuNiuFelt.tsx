import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { PlayingCard } from '@/components/poker/PlayingCard';
import type { LiveSeat, TableCommand, TableSnapshot } from '@/lib/liveTable';

/**
 * NIU NIU (BULL BULL) — a real table, not a list of seats.
 *
 * Players sit around an oval felt, each with their own five cards and the multiplier they are
 * playing at; the round clock runs in the middle. You are always at the bottom, whichever chair you
 * actually took, because a player reads their own hand from the near edge of the table.
 *
 * The round runs in two stages and the controls follow `snapshot.stage`:
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

/**
 * Where each chair sits on the felt, starting from the near edge and going round.
 *
 * Slot 0 is the bottom centre and always belongs to the viewer; the rest are filled clockwise from
 * whoever sits to their left, so the table reads the same from every seat.
 */
const SLOTS = [
  { left: '50%', top: '80%' },
  { left: '24%', top: '76%' },
  { left: '9%', top: '48%' },
  { left: '27%', top: '19%' },
  { left: '50%', top: '14%' },
  { left: '73%', top: '19%' },
  { left: '91%', top: '48%' },
  { left: '76%', top: '76%' },
];

/** Seconds left on the round clock, or null when nothing is running. */
function useCountdown(deadline: number | null | undefined, serverTime: number | undefined): number | null {
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
    /**
     * The seats are positioned on the felt, so almost nothing here is in normal flow. The stage
     * below therefore carries an explicit height: the screen lays the felt out with `items-center`,
     * which sizes a child to its content, and a table made only of absolute children measures zero
     * and disappears behind `overflow-hidden`.
     */
    <div className="relative w-full self-stretch overflow-hidden bg-emerald-950 text-white select-none">
      {/* Capped and centred: at full window width the table grew tall enough to push the controls
          below the fold, and a player could not find the way to sit down. */}
      <div className="relative mx-auto h-[22rem] w-full max-w-4xl sm:h-[26rem]">
      {/*
        The table: a stadium, turned landscape so its long edges face the players.
        Four layers, outside in — the padded black rail, the gold trim, the felt lit from its rim,
        and two faint inset guide lines the way a real cloth is marked.
      */}
      <div className="absolute inset-x-4 inset-y-3 rounded-full bg-gradient-to-b from-[#2a2622] to-[#0d0b09] p-[14px] shadow-[0_25px_60px_rgba(0,0,0,0.7)]">
        <div className="h-full w-full rounded-full bg-gradient-to-b from-[#d9b45f] to-[#8a6a24] p-[3px]">
          <div className="relative h-full w-full overflow-hidden rounded-full bg-[radial-gradient(ellipse_at_center,#04422a_25%,#0c7a4a_72%,#17c077_100%)] shadow-[inset_0_0_45px_rgba(16,185,129,0.5),inset_0_0_130px_rgba(0,0,0,0.5)]">
            <div className="absolute inset-6 rounded-full border border-emerald-300/15" />
            <div className="absolute inset-10 rounded-full border border-emerald-300/10" />
          </div>
        </div>
      </div>

      {/* Table plate */}
      <div className="absolute top-4 left-1/2 z-20 -translate-x-1/2 text-center">
        <div className="text-sm font-black tracking-[0.3em] text-amber-300/90">NIU NIU</div>
        {round && round.bankerMultiplier > 1 && (
          <div className="text-[0.65rem] font-bold text-amber-200/80">
            BANK PAYS {round.bankerMultiplier}×
          </div>
        )}
      </div>

      {/* Round clock */}
      <div className="absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 text-center">
        {secondsLeft !== null && phase === 'IN_HAND' ? (
          <div className="grid h-20 w-20 place-items-center rounded-full border-4 border-amber-400/80 bg-black/40 text-3xl font-black text-amber-200 shadow-lg">
            {secondsLeft}
          </div>
        ) : null}
        <div className="mt-2 rounded-full bg-black/45 px-4 py-1 text-xs font-bold tracking-wide text-emerald-100">
          {centreLabel}
        </div>
        {phase === 'WAITING' && snapshot?.message && (
          <div className="mt-2 max-w-xs text-xs text-emerald-200/80">{snapshot.message}</div>
        )}
      </div>

      {/* Seats */}
      {ordered.map((seat, place) => {
        const slot = SLOTS[place % SLOTS.length]!;
        return (
          <SeatSpot
            key={seat.index}
            seat={seat}
            slot={slot}
            info={stateOf(seat.index)}
            bankMultiplier={round?.bankerMultiplier ?? 1}
            big={seat.isYou}
          />
        );
      })}
      </div>

      {/* Controls — in normal flow, under the table */}
      <div className="relative z-30 flex flex-col items-center gap-2 bg-black/30 px-3 py-3">
        {!isSeated ? (
          <Button variant="primary" size="sm" onClick={sitDown}>
            Sit to Play Niu Niu
          </Button>
        ) : stage === 'BIDDING' ? (
          <>
            <span className="rounded-full bg-black/45 px-3 py-1 text-[0.7rem] text-emerald-100">
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
                    betAmount === amt
                      ? 'bg-amber-400 text-black ring-2 ring-amber-200'
                      : 'bg-emerald-900 text-emerald-200'
                  }`}
                >
                  {amt}
                </button>
              ))}
              <span className="mx-1 text-emerald-700">|</span>
              {STAKE_MULTIPLIERS.map((m) => (
                <button
                  key={m}
                  onClick={() => setMultiplier(m)}
                  className={`rounded-full px-3 py-1 text-xs font-black transition ${
                    multiplier === m ? 'bg-amber-400 text-black' : 'bg-emerald-900 text-emerald-200'
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
          <span className="rounded-full bg-black/45 px-3 py-1 text-[0.7rem] text-emerald-200">
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
  slot: { left: string; top: string };
  info: NiuNiuRoundState['seats'][number] | undefined;
  bankMultiplier: number;
  big: boolean;
}

/** One chair: nameplate, stack, their five cards, and what they are playing at. */
function SeatSpot({ seat, slot, info, bankMultiplier, big }: SeatSpotProps) {
  const badge = seat.isDealer
    ? `${bankMultiplier}×`
    : info?.betMultiplier
      ? `${info.betMultiplier}×`
      : info?.bid
        ? `bid ${info.bid}×`
        : null;

  return (
    <div
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ left: slot.left, top: slot.top }}
    >
      <div className="flex flex-col items-center gap-1">
        {seat.cards.length > 0 && (
          <div className="flex gap-0.5">
            {seat.cards.map((card, i) => (
              <PlayingCard key={i} card={card} size={big ? 'md' : 'sm'} index={i} />
            ))}
          </div>
        )}

        {info?.hand && (
          <div className="rounded bg-black/60 px-2 py-0.5 text-[0.65rem] font-black tracking-wide text-amber-300">
            {info.hand}
          </div>
        )}

        <div
          className={`min-w-24 rounded-xl border px-3 py-1 text-center shadow-lg ${
            seat.isDealer
              ? 'border-amber-400/70 bg-amber-500/15'
              : 'border-emerald-400/30 bg-black/45'
          }`}
        >
          <div className="truncate text-xs font-bold text-amber-200">{seat.name}</div>
          <div className="text-[0.7rem] font-semibold text-white">₮{seat.stack}</div>
          {seat.isDealer && (
            <div className="text-[0.6rem] font-black tracking-wider text-amber-300">👑 BANKER</div>
          )}
          {seat.bet > 0 && (
            <div className="text-[0.65rem] text-emerald-200">bet ₮{seat.bet}</div>
          )}
          {info?.net !== undefined && info.net !== 0 && (
            <div
              className={`text-[0.7rem] font-black ${info.net > 0 ? 'text-emerald-400' : 'text-rose-400'}`}
            >
              {info.net > 0 ? '+' : ''}
              {info.net}
            </div>
          )}
        </div>
      </div>

      {badge && (
        <div className="absolute -top-2 -right-3 rounded-full bg-amber-400 px-2 py-0.5 text-[0.65rem] font-black text-black shadow">
          {badge}
        </div>
      )}
    </div>
  );
}
