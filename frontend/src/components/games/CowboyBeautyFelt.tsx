import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { PlayingCard } from '@/components/poker/PlayingCard';
import { TableNotice } from './TableNotice';
import { SeatStrip } from './SeatStrip';
import type { TableCommand, TableSnapshot } from '@/lib/liveTable';

/**
 * COWBOY & BEAUTY — one card each, and a parimutuel bet on which is higher.
 *
 * The two numbers that decide how you bet are what the side is holding and what it currently pays,
 * and neither used to reach the felt: it showed two buttons and, after the fact, two cards. Odds
 * move as the pools fill and then FREEZE when the window closes, so both are on screen the whole
 * time, with the freeze called out — a price that stopped moving means something here.
 *
 * The server owns all of it. Pools, odds and the result come from the round; nothing is computed
 * on this side except turning basis points into a readable multiple.
 */

type Side = 'COWBOY' | 'BEAUTY';

/** Mirrors the `gameState` built in game-server/src/live/cowboy-beauty-room.ts. */
interface CowboyBeautyRound {
  pools: Record<string, number>;
  oddsBps: Record<string, number | null>;
  revealed: boolean;
  cowboyCard: string | null;
  beautyCard: string | null;
  winner: string | null;
}

export interface CowboyBeautyFeltProps {
  snapshot?: TableSnapshot | null;
  onCommand?: (cmd: TableCommand) => void;
}

const CHIPS = [50, 100, 500, 1_000];

/** 21500 bps → "2.15×". Null means no price yet — an empty pool has no odds to quote. */
const asMultiple = (bps: number | null | undefined): string =>
  bps === null || bps === undefined ? '—' : `${(bps / 10_000).toFixed(2)}×`;

export function CowboyBeautyFelt({ snapshot, onCommand }: CowboyBeautyFeltProps) {
  const [side, setSide] = useState<Side>('COWBOY');
  const [betAmount, setBetAmount] = useState(100);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const phase = snapshot?.phase ?? 'WAITING';
  const seats = snapshot?.seats ?? [];
  const you = seats.find((s) => s.isYou);
  const round = snapshot?.gameState as CowboyBeautyRound | undefined;
  const isSeated = Boolean(you);
  const staked = you?.bet ?? 0;

  const secondsLeft = snapshot?.actionDeadline
    ? Math.max(0, Math.ceil((snapshot.actionDeadline - now) / 1_000))
    : null;

  const sitDown = (): void => {
    const free = seats.find((s) => !s.playerId);
    onCommand?.({ kind: 'sit', seat: free?.index ?? 0, buyIn: snapshot?.minBuyIn ?? 1_000 });
  };

  const back = (which: Side): void => {
    setSide(which);
    if (!isSeated || phase !== 'IN_HAND') return;
    onCommand?.({
      kind: 'act',
      action: { type: which === 'COWBOY' ? 'cowboy' : 'beauty', amount: betAmount },
    });
  };

  return (
    <div className="relative flex min-h-[32rem] w-full flex-col self-stretch overflow-hidden bg-slate-950 p-4 text-white select-none">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#1e293b_0%,#0f172a_75%)]" />

      <div className="relative z-10 flex items-center justify-between border-b border-slate-800/40 pb-2">
        <div className="flex items-center gap-3">
          <span className="font-bold tracking-wider text-amber-400">COWBOY &amp; BEAUTY</span>
          <span className="rounded bg-slate-800/60 px-2 py-0.5 text-xs text-slate-200">
            {secondsLeft !== null && phase === 'IN_HAND' ? `${secondsLeft}s` : phase}
          </span>
        </div>
        <div className="text-xs text-slate-300">
          Pot <span className="font-bold text-amber-300">${snapshot?.pot ?? 0}</span>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center gap-4 py-5">
        <SideCard
          side="COWBOY"
          emoji="🤠"
          accent="text-amber-300"
          pool={round?.pools?.COWBOY ?? 0}
          odds={round?.oddsBps?.COWBOY ?? null}
          card={round?.cowboyCard ?? null}
          won={round?.winner === 'COWBOY'}
          picked={side === 'COWBOY'}
          yours={side === 'COWBOY' ? staked : 0}
          onPick={() => back('COWBOY')}
        />
        <div className="text-xs font-black tracking-widest text-slate-500">VS</div>
        <SideCard
          side="BEAUTY"
          emoji="💃"
          accent="text-rose-300"
          pool={round?.pools?.BEAUTY ?? 0}
          odds={round?.oddsBps?.BEAUTY ?? null}
          card={round?.beautyCard ?? null}
          won={round?.winner === 'BEAUTY'}
          picked={side === 'BEAUTY'}
          yours={side === 'BEAUTY' ? staked : 0}
          onPick={() => back('BEAUTY')}
        />
      </div>

      {round?.winner && (
        <div className="relative z-10 mx-auto rounded-full bg-amber-400/20 px-4 py-1 text-sm font-black tracking-wider text-amber-300">
          {round.winner} WINS
        </div>
      )}

      <div className="relative z-10 px-2 pt-3">
        <SeatStrip seats={seats} />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-2 pt-2">
        {isSeated && phase === 'IN_HAND' ? (
          <>
            <div className="flex items-center gap-2">
              {CHIPS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setBetAmount(amt)}
                  className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                    betAmount === amt ? 'bg-amber-400 text-black' : 'bg-slate-800 text-slate-200'
                  }`}
                >
                  ${amt}
                </button>
              ))}
            </div>
            <Button variant="primary" size="sm" onClick={() => back(side)}>
              {staked > 0 ? `Staked $${staked} on ${side}` : `Back ${side} for $${betAmount}`}
            </Button>
          </>
        ) : isSeated ? (
          <TableNotice snapshot={snapshot} />
        ) : (
          <Button variant="primary" size="sm" onClick={sitDown}>
            Sit to Play Cowboy &amp; Beauty
          </Button>
        )}
      </div>
    </div>
  );
}

/** One side: what it pays, what is riding on it, and its card once the round reveals. */
function SideCard({
  side,
  emoji,
  accent,
  pool,
  odds,
  card,
  won,
  picked,
  yours,
  onPick,
}: {
  side: Side;
  emoji: string;
  accent: string;
  pool: number;
  odds: number | null;
  card: string | null;
  won: boolean;
  picked: boolean;
  yours: number;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      className={`relative flex w-40 flex-col items-center gap-2 rounded-2xl border-2 px-4 py-4 transition ${
        won
          ? 'border-amber-400 bg-amber-400/15'
          : picked
            ? 'border-white/40 bg-white/5'
            : 'border-slate-700 bg-slate-900/50 hover:bg-slate-800/60'
      }`}
    >
      <div className="text-4xl">{emoji}</div>
      <div className={`text-sm font-black tracking-widest ${accent}`}>{side}</div>

      {/* The price. It drifts while the pools fill, then stops when betting closes. */}
      <div className="font-mono text-2xl font-black text-white">{asMultiple(odds)}</div>
      <div className="text-[0.7rem] text-slate-400">pool ${pool}</div>

      <PlayingCard {...(card ? { card } : {})} size="md" />

      {yours > 0 && (
        <span className="absolute -top-2 rounded-full bg-amber-400 px-2 text-[0.65rem] font-black text-black">
          ${yours}
        </span>
      )}
    </button>
  );
}
