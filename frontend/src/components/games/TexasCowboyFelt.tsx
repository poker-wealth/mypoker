import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayingCard } from '@/components/poker/PlayingCard';
import type { TableCommand, TableSnapshot } from '@/lib/liveTable';

/**
 * TEXAS COWBOY — a betting board, not a poker seat.
 *
 * Two hands are dealt, Cowboy and Cowgirl, and nobody plays them: the table bets on the outcome.
 * So the screen is read top to bottom — the scene, then the board. Tap a chip, tap a market, the
 * bet is placed; there is no separate confirm step, because a window that closes in twelve seconds
 * cannot afford one.
 *
 * The server owns every number here. Odds, stakes and the road all come from the round; the felt
 * never multiplies anything out except to preview a return.
 */

export type PokerHandType =
  | 'HIGH_CARD'
  | 'ONE_PAIR'
  | 'TWO_PAIR'
  | 'THREE_OF_A_KIND'
  | 'STRAIGHT'
  | 'FLUSH'
  | 'FULL_HOUSE'
  | 'FOUR_OF_A_KIND'
  | 'STRAIGHT_FLUSH'
  | 'ROYAL_FLUSH';

export interface TexasCowboyRound {
  id: string;
  roundNumber: number;
  phase: string;
  bettingWindow: { openedAt: number; closesAt: number } | null;
  cowboy: {
    holeCards: string[];
    evaluation: { type: PokerHandType; displayName: string } | null;
  };
  cowgirl: {
    holeCards: string[];
    evaluation: { type: PokerHandType; displayName: string } | null;
  };
  communityCards: string[];
  markets: { id: string; name: string; multiplier: number; enabled: boolean }[];
  result: {
    winner: 'COWBOY' | 'COWGIRL' | 'TIE';
    winningHandType: PokerHandType | null;
  } | null;
  /** Chips the whole table has on each market. Public, like chips on a felt. */
  pools?: Record<string, number>;
  /** Chips YOU have on each market. Present only in your own snapshot. */
  yourStakes?: Record<string, number>;
  /** Who won the last rounds, oldest first. The road. */
  history?: Array<'COWBOY' | 'COWGIRL' | 'TIE'>;
}

/** The board, in the rows it is read in. */
const ROWS: Array<{ label: string; markets: string[] }> = [
  { label: 'Who wins', markets: ['cowboy_win', 'tie', 'cowgirl_win'] },
  { label: 'Either hand makes', markets: ['high_card', 'one_pair', 'two_pair'] },
  { label: 'Winning hand', markets: ['three_of_a_kind', 'straight', 'flush'] },
  { label: 'Long shots', markets: ['full_house', 'four_of_a_kind', 'straight_flush', 'royal_flush'] },
];

const CHIPS = [100, 500, 1_000, 5_000];

const titleOf = (id: string): string =>
  id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function TexasCowboyFelt({
  snapshot,
  onCommand,
}: {
  snapshot?: TableSnapshot | null;
  onCommand?: (cmd: TableCommand) => void;
}) {
  const [chip, setChip] = useState<number>(100);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);

  // The round arrives in its own field. It used to be JSON stuffed into `message` — the line the
  // result banner prints — which put the whole round state on screen as text.
  const round = (snapshot?.gameState as TexasCowboyRound | undefined) ?? null;
  const seats = snapshot?.seats ?? [];
  const you = seats.find((s) => s.isYou);

  const sitDown = (): void => {
    const free = seats.find((s) => !s.playerId);
    onCommand?.({ kind: 'sit', seat: free?.index ?? 0, buyIn: snapshot?.minBuyIn ?? 1_000 });
  };

  const closesAt = snapshot?.actionDeadline ?? round?.bettingWindow?.closesAt ?? 0;
  const remaining = Math.max(0, closesAt - now);
  const isBettingOpen = round?.phase === 'BETTING_OPEN';

  const oddsOf = (id: string): number => round?.markets.find((m) => m.id === id)?.multiplier ?? 0;
  const poolOf = (id: string): number => round?.pools?.[id] ?? 0;
  const yoursOn = (id: string): number => round?.yourStakes?.[id] ?? 0;

  const bet = (marketId: string): void => {
    if (!isBettingOpen || !you) return;
    onCommand?.({ kind: 'act', action: { type: 'bet', amount: chip, selection: marketId } });
  };

  return (
    <div className="relative flex min-h-[40rem] w-full flex-col self-stretch overflow-hidden bg-[#07301f] text-white select-none">
      {/*
        The scene: the two of them facing each other, the community cards dealt between them, the
        clock above. It is the top of the screen and the board is everything below, because that is
        the order the game is read in — watch the hands, then back a market.
      */}
      <div className="relative h-52 shrink-0 overflow-hidden bg-[radial-gradient(ellipse_at_center,#1b6b47_0%,#0a3a25_75%)]">
        <Duelist
          side="left"
          title="COWBOY"
          emoji="🤠"
          accent="text-amber-200"
          cards={round?.cowboy.holeCards ?? []}
          hand={round?.cowboy.evaluation?.displayName}
          won={round?.result?.winner === 'COWBOY'}
        />
        <Duelist
          side="right"
          title="COWGIRL"
          emoji="💃"
          accent="text-rose-200"
          cards={round?.cowgirl.holeCards ?? []}
          hand={round?.cowgirl.evaluation?.displayName}
          won={round?.result?.winner === 'COWGIRL'}
        />

        {/* The clock */}
        <div className="absolute top-2 left-1/2 z-20 -translate-x-1/2">
          {remaining > 0 && isBettingOpen ? (
            <div
              className={`grid h-14 w-14 place-items-center rounded-full border-4 text-lg font-black tabular-nums ${
                remaining > 3_000
                  ? 'border-emerald-300 bg-black/50 text-emerald-200'
                  : 'animate-pulse border-rose-500 bg-black/50 text-rose-300'
              }`}
            >
              {Math.ceil(remaining / 1_000)}s
            </div>
          ) : (
            <div className="rounded-full bg-black/60 px-3 py-1 text-[0.7rem] font-black tracking-wider text-emerald-200">
              {round?.phase === 'SETTLED' ? 'SETTLED' : 'BETS CLOSED'}
            </div>
          )}
        </div>

        {/* The community cards, dealt between them */}
        <div className="absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 gap-1">
          {Array.from({ length: 5 }, (_, i) => {
            const card = round?.communityCards[i];
            return <PlayingCard key={i} {...(card ? { card } : {})} size="md" index={i} />;
          })}
        </div>

        {/* The road: how the last rounds went */}
        <div className="absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 px-3 py-1">
          <span className="mr-1 text-[0.6rem] font-bold tracking-wider text-emerald-200/70">
            ROUND #{round?.roundNumber ?? '—'}
          </span>
          {(round?.history ?? []).slice(-14).map((w, i) => (
            <span
              key={i}
              title={w}
              className={`h-2 w-2 rounded-full ${
                w === 'COWBOY' ? 'bg-amber-400' : w === 'COWGIRL' ? 'bg-rose-400' : 'bg-emerald-300'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Result */}
      <AnimatePresence>
        {round?.result && (
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            className="absolute top-24 left-1/2 z-50 -translate-x-1/2 rounded-2xl border-2 border-amber-500 bg-black/80 px-8 py-4 text-center backdrop-blur-md"
          >
            <div className="text-3xl font-black tracking-tight uppercase">
              {round.result.winner === 'TIE' ? 'TIE' : `${round.result.winner} WINS`}
            </div>
            {round.result.winningHandType && (
              <div className="mt-1 text-base font-bold text-amber-400">
                {titleOf(round.result.winningHandType)}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/*
        The board. One bordered grid, not floating cards: each row is a group with its name in the
        left block, and every cell carries the chips already riding on it, so a glance tells you
        where the table's money is.
      */}
      <div className="relative z-10 flex-1 border-y-2 border-amber-900/60 bg-[#0d5236]">
        {ROWS.map((row) => (
          <div
            key={row.label}
            className="flex items-stretch border-b border-emerald-900/70 last:border-b-0"
          >
            <div className="grid w-20 shrink-0 place-items-center border-r border-emerald-900/70 bg-[#0a4229] px-1 text-center text-[0.68rem] leading-tight font-black tracking-wide text-amber-300">
              {row.label}
            </div>
            <div className="flex flex-1">
              {row.markets.map((id) => (
                <MarketCell
                  key={id}
                  id={id}
                  odds={oddsOf(id)}
                  pool={poolOf(id)}
                  yours={yoursOn(id)}
                  open={isBettingOpen && Boolean(you)}
                  onBet={() => bet(id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Chips, or the way in */}
      <div className="relative z-10 flex items-center justify-center gap-3 px-4 py-3">
        {!you ? (
          <button
            onClick={sitDown}
            className="w-full max-w-md rounded-full bg-gradient-to-b from-amber-300 to-amber-500 py-3 text-sm font-black tracking-widest text-black uppercase shadow-lg active:scale-95"
          >
            Join Game
          </button>
        ) : (
          <>
            <div className="flex gap-2">
              {CHIPS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setChip(amt)}
                  className={`h-12 w-12 rounded-full border-[3px] text-[0.7rem] font-black shadow-lg transition ${
                    chip === amt
                      ? 'border-amber-300 bg-amber-500 text-black'
                      : 'border-emerald-700 bg-emerald-900 text-emerald-200'
                  }`}
                >
                  {amt >= 1_000 ? `${amt / 1_000}k` : amt}
                </button>
              ))}
            </div>
            <div className="text-[0.7rem] text-emerald-200/80">
              {isBettingOpen ? `Tap a market to stake ₮${chip}` : 'Betting is closed'}
              <div className="font-bold text-white">Balance ₮{you.stack}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One of the two hands, standing at their end of the scene. */
function Duelist({
  side,
  title,
  accent,
  emoji,
  cards,
  hand,
  won,
}: {
  side: 'left' | 'right';
  title: string;
  accent: string;
  emoji: string;
  cards: string[];
  hand?: string | undefined;
  won: boolean;
}) {
  return (
    <div
      className={`absolute bottom-0 z-10 flex w-32 flex-col items-center pb-6 ${
        side === 'left' ? 'left-2' : 'right-2'
      }`}
    >
      <div className={`text-5xl drop-shadow-lg ${side === 'right' ? 'scale-x-[-1]' : ''}`}>
        {emoji}
      </div>
      <div
        className={`rounded-full px-3 text-xs font-black tracking-widest ${accent} ${
          won ? 'bg-amber-400/25 ring-1 ring-amber-300' : ''
        }`}
      >
        {title}
      </div>
      <div className="mt-1 flex gap-1">
        {cards.length > 0
          ? cards.map((c, i) => <PlayingCard key={i} card={c} size="sm" index={i} />)
          : [0, 1].map((i) => <PlayingCard key={i} size="sm" faceDown />)}
      </div>
      {hand && (
        <div className="mt-1 rounded bg-black/60 px-1.5 text-[0.6rem] font-bold text-emerald-300">
          {hand}
        </div>
      )}
    </div>
  );
}

/** One market on the board: what the table has on it, the odds, and what you have on it. */
function MarketCell({
  id,
  odds,
  pool,
  yours,
  open,
  onBet,
}: {
  id: string;
  odds: number;
  pool: number;
  yours: number;
  open: boolean;
  onBet: () => void;
}) {
  return (
    <button
      disabled={!open}
      onClick={onBet}
      className={`relative flex flex-1 flex-col items-center justify-center border-r border-emerald-900/70 px-1 py-3 transition last:border-r-0 ${
        yours > 0 ? 'bg-amber-400/15' : 'hover:bg-emerald-800/50'
      } disabled:cursor-default`}
    >
      {/* What the table is backing, above the name — the chips on the cell. */}
      <span className="h-4 text-[0.65rem] font-bold text-white/90">
        {pool > 0 ? `🪙 ${pool}` : ''}
      </span>
      <span className="text-[0.68rem] leading-tight font-bold tracking-wide text-emerald-50">
        {titleOf(id)}
      </span>
      <span className="font-mono text-base font-black text-amber-300">{odds}×</span>

      {yours > 0 && (
        <span className="absolute top-1 right-1 rounded-full bg-amber-400 px-1.5 text-[0.6rem] font-black text-black shadow">
          ₮{yours}
        </span>
      )}
    </button>
  );
}
