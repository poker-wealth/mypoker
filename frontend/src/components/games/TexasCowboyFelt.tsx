import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers } from 'lucide-react';
import { PlayingCard } from '@/components/poker/PlayingCard';
import { cn } from '@/lib/cn';
import type { TableCommand, TableSnapshot } from '@/lib/liveTable';

/**
 * TEXAS COWBOY — laid out after the reference's Cowboy screen, as closely as the owner asked.
 *
 * Top to bottom, in its order: the two of them facing each other with their hole cards, the board
 * dealt between them, the road in a dark pill beneath; then the paytable as bordered blocks with a
 * dark header strip on every cell, a gold label block down the side of a group, a dot trail or a
 * "hands vacant" line under each hand market; then one full-width gold "Join Game" pill.
 *
 * ── Where it differs from the reference, and why ────────────────────────────
 *
 * OUR BETS, THEIR LAYOUT. The reference prints one cell for "High card / One pair" and one for
 * "Three of a kind / Straight / Flush". Ours are separate markets on the server — a bet on Straight
 * does not win on a Flush — so a merged cell would be a tap that cannot say which bet it placed.
 * Each market keeps its own cell, arranged into the reference's rows: its merged cells are split in
 * place rather than moved. Its "Either hand type" block (suited/connects, pair, pair A's) has no
 * market behind it here and is not drawn.
 *
 * THE ODDS ARE OURS. Flush reads 6x, not their 4.5x. Every multiplier comes from the round.
 *
 * THE CHARACTERS ARE OURS. This laid out placeholders for art at these positions and the art has
 * since arrived (Victor, 14 Sep 2026): cowboy.webp and cowgirl.webp, 2.8 MB of PNG converted to
 * 251 KB of WebP because brand art ships as WebP here. The right-hand one keeps this layout's
 * horizontal flip and earns it — the two were not drawn as a pair, and unflipped she looks away
 * from him.
 *
 * NO FIGURE IS INVENTED. A trail is drawn only from what the server recorded; a market with no
 * record yet shows no dots. A vacancy that is a lower bound (the market has not paid since the
 * table started) prints with a "+".
 *
 * NO GROUND OF ITS OWN. The table screen paints the ground the player picked; every surface here is
 * translucent, so on the default green it reads like the reference and on any other colour it
 * reads as the same board.
 *
 * The server owns every number here. Odds, stakes, trails and the road all come from the round.
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
  /** Per market, whether each of the last rounds paid it, oldest first. */
  marketHistory?: Record<string, boolean[]>;
  /** Per market, rounds since it last paid. `exact: false` means "at least" — see the room. */
  vacant?: Record<string, { rounds: number; exact: boolean }>;
}

/** The reference's wording for each of our markets. */
const LABEL: Record<string, string> = {
  cowboy_win: 'Cowboy Win',
  tie: 'Push',
  cowgirl_win: 'Cowgirl Win',
  high_card: 'High card',
  one_pair: 'One pair',
  two_pair: 'Two pairs',
  three_of_a_kind: 'Three of a kind',
  straight: 'Straight',
  flush: 'Flush',
  full_house: 'Full House',
  four_of_a_kind: 'Four of a kind',
  straight_flush: 'Straight Flush',
  royal_flush: 'Royal Flush',
};

/**
 * From this multiplier up, a cell carries "N hands vacant" instead of a dot trail — the reference
 * does the same for its rare outcomes, where a row of grey dots says nothing a count does not.
 */
const LONG_SHOT = 20;

const CHIPS = [100, 500, 1_000, 5_000];

/** The reference's palette, as translucent layers so the player's ground still shows through. */
const GOLD = '#d4b26a';
const CREAM = '#f4ecd6';
const DISPLAY = "'Oswald', 'Arial Narrow', 'Roboto Condensed', ui-sans-serif, sans-serif";

export function TexasCowboyFelt({
  snapshot,
  onCommand,
  onSit,
}: {
  snapshot?: TableSnapshot | null;
  onCommand?: (cmd: TableCommand) => void;
  /** Opens the buy-in sheet. See FeltComponent.onSit in registry.ts. */
  onSit: (seatIndex: number) => void;
}) {
  const [chip, setChip] = useState<number>(100);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const round = (snapshot?.gameState as TexasCowboyRound | undefined) ?? null;
  const seats = snapshot?.seats ?? [];
  const you = seats.find((s) => s.isYou);

  const sitDown = (): void => {
    const free = seats.find((s) => !s.playerId);
    onSit(free?.index ?? 0);
  };

  const closesAt = snapshot?.actionDeadline ?? round?.bettingWindow?.closesAt ?? 0;
  const remaining = Math.max(0, closesAt - now);
  const isBettingOpen = round?.phase === 'BETTING_OPEN';
  const canBet = isBettingOpen && Boolean(you);

  const bet = (marketId: string): void => {
    if (!canBet) return;
    onCommand?.({ kind: 'act', action: { type: 'bet', amount: chip, selection: marketId } });
  };

  const cell = (id: string, opts: { small?: boolean } = {}) => (
    <MarketCell
      key={id}
      label={LABEL[id] ?? id}
      odds={round?.markets.find((m) => m.id === id)?.multiplier ?? 0}
      pool={round?.pools?.[id] ?? 0}
      yours={round?.yourStakes?.[id] ?? 0}
      trail={round?.marketHistory?.[id]}
      vacant={round?.vacant?.[id]}
      showTrail={id !== 'cowboy_win' && id !== 'cowgirl_win' && id !== 'tie'}
      open={canBet}
      small={Boolean(opts.small)}
      onBet={() => bet(id)}
    />
  );

  return (
    <div
      className="relative flex w-full flex-col self-stretch overflow-y-auto text-white select-none"
      style={{ fontFamily: DISPLAY }}
    >
      {/* ── The scene ─────────────────────────────────────────────────────── */}
      <div className="relative aspect-[10/7] w-full shrink-0 overflow-hidden">
        <Duelist
          side="left"
          art="/brand/cowboy.webp"
          cards={round?.cowboy.holeCards ?? []}
          won={round?.result?.winner === 'COWBOY'}
          hand={round?.cowboy.evaluation?.displayName}
        />
        <Duelist
          side="right"
          art="/brand/cowgirl.webp"
          cards={round?.cowgirl.holeCards ?? []}
          won={round?.result?.winner === 'COWGIRL'}
          hand={round?.cowgirl.evaluation?.displayName}
        />

        {/* The clock, only while it means something. */}
        {isBettingOpen && remaining > 0 && (
          <div
            className={cn(
              'absolute top-3 left-1/2 z-20 grid size-11 -translate-x-1/2 place-items-center rounded-full border-2 bg-black/45 text-base font-bold tabular-nums',
              remaining > 3_000 ? 'border-[#d4b26a] text-[#f4ecd6]' : 'animate-pulse border-rose-500 text-rose-200',
            )}
          >
            {Math.ceil(remaining / 1_000)}
          </div>
        )}

        {/* The board, dealt between them: face-up once revealed, the reference's red backs until. */}
        <div className="absolute top-[40%] left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 gap-1">
          {Array.from({ length: 5 }, (_, i) => {
            const card = round?.communityCards[i];
            return card ? (
              <PlayingCard key={i} card={card} size="md" index={i} />
            ) : (
              <CardBack key={i} className="h-16 w-11" />
            );
          })}
        </div>

        {/* The table's name where the reference prints its stake tier, then the road. */}
        <div className="absolute bottom-[6%] left-1/2 z-20 flex w-[62%] -translate-x-1/2 flex-col items-center gap-1.5">
          <span className="text-[0.8rem] tracking-wide" style={{ color: CREAM }}>
            {snapshot?.name ?? ''}
          </span>
          <div className="flex h-7 w-full items-center gap-1.5 rounded-full bg-[#2a120c]/85 px-2.5">
            <Layers size={16} className="shrink-0" style={{ color: CREAM }} aria-hidden />
            <div className="flex flex-1 items-center justify-center gap-[5px] overflow-hidden">
              {(round?.history ?? []).slice(-10).map((w, i) => (
                <span
                  key={i}
                  title={w}
                  className="size-2.5 shrink-0 rounded-full"
                  style={{
                    background: w === 'COWBOY' ? '#2cc4c9' : w === 'COWGIRL' ? '#d42a3c' : GOLD,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Result, over the scene. */}
      <AnimatePresence>
        {round?.result && (
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.7, opacity: 0 }}
            className="absolute top-[18%] left-1/2 z-50 -translate-x-1/2 rounded-xl border px-7 py-3 text-center backdrop-blur-sm"
            style={{ borderColor: GOLD, background: 'rgba(20,12,6,0.82)' }}
          >
            <div className="text-2xl font-bold tracking-wide uppercase" style={{ color: CREAM }}>
              {round.result.winner === 'TIE'
                ? 'Push'
                : `${round.result.winner === 'COWBOY' ? 'Cowboy' : 'Cowgirl'} Win`}
            </div>
            {round.result.winningHandType && (
              <div className="mt-0.5 text-sm" style={{ color: GOLD }}>
                {LABEL[round.result.winningHandType.toLowerCase()] ?? round.result.winningHandType}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── The paytable ──────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col gap-3 px-2.5 pt-1 pb-3">
        {/* Outcome */}
        <Block>
          <div className="grid grid-cols-[1.2fr_0.9fr_1.2fr]">
            {cell('cowboy_win')}
            {cell('tie')}
            {cell('cowgirl_win')}
          </div>
        </Block>

        {/* Winning hand rank — the reference's merged cells, split in place. */}
        <Block>
          <div className="grid grid-cols-[0.95fr_1fr_1fr_1fr]">
            <div
              className="grid place-items-center border-r px-1 text-center text-[1.05rem] leading-tight font-semibold"
              style={{ borderColor: `${GOLD}66`, background: 'rgba(0,0,0,0.32)', color: GOLD }}
            >
              Winning
              <br />
              hand rank
            </div>
            {cell('high_card')}
            {cell('one_pair')}
            {cell('two_pair')}
          </div>
          <div className="grid grid-cols-3 border-t" style={{ borderColor: `${GOLD}66` }}>
            {cell('three_of_a_kind', { small: true })}
            {cell('straight')}
            {cell('flush')}
          </div>
          <div className="grid grid-cols-4 border-t" style={{ borderColor: `${GOLD}66` }}>
            {cell('full_house', { small: true })}
            {cell('four_of_a_kind', { small: true })}
            {cell('straight_flush', { small: true })}
            {cell('royal_flush', { small: true })}
          </div>
        </Block>
      </div>

      {/* ── Join, or your chips ───────────────────────────────────────────── */}
      <div className="relative z-10 mt-auto px-6 pt-1 pb-4">
        {!you ? (
          <button
            type="button"
            onClick={sitDown}
            className="w-full rounded-full py-3 text-[1.35rem] tracking-wide shadow-lg transition active:scale-[0.98]"
            style={{ background: '#f1d665', color: '#8a5620', fontFamily: 'var(--font-sans)' }}
          >
            Join Game
          </button>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-2">
              {CHIPS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setChip(amt)}
                  className="grid size-11 place-items-center rounded-full border-2 text-[0.72rem] font-semibold transition"
                  style={
                    chip === amt
                      ? { borderColor: GOLD, background: '#f1d665', color: '#5c3a12' }
                      : { borderColor: `${GOLD}80`, background: 'rgba(0,0,0,0.3)', color: CREAM }
                  }
                >
                  {amt >= 1_000 ? `${amt / 1_000}k` : amt}
                </button>
              ))}
            </div>
            <div className="text-right text-[0.72rem] leading-tight" style={{ color: CREAM }}>
              {isBettingOpen ? `Tap a bet to stake ${chip}` : 'Betting is closed'}
              <div className="text-sm font-semibold" style={{ color: GOLD }}>
                {you.stack}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** One bordered group on the paytable: gold hairline, rounded corners. */
function Block({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: `${GOLD}99` }}>
      {children}
    </div>
  );
}

/**
 * The reference's card back — a red fan-scale pattern inside a white border. Drawn here rather
 * than through PlayingCard, whose face-down side is the brand back used at every other table.
 */
function CardBack({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-md border-2 border-white shadow-md', className)}
      style={{
        backgroundColor: '#e07682',
        backgroundImage:
          'radial-gradient(circle at 50% 100%, transparent 42%, rgba(255,255,255,0.28) 46%, transparent 52%)',
        backgroundSize: '9px 7px',
      }}
    />
  );
}

/** One of the two characters, at their end of the scene, holding their two cards. */
function Duelist({
  side,
  art,
  cards,
  won,
  hand,
}: {
  side: 'left' | 'right';
  /** The character's portrait, bottom-anchored in the scene. */
  art: string;
  cards: string[];
  won: boolean;
  hand?: string | undefined;
}) {
  return (
    <div
      className={cn(
        'absolute bottom-0 z-10 flex h-full w-[32%] flex-col items-center justify-end',
        side === 'left' ? 'left-0' : 'right-0',
      )}
    >
      {/*
        THE REAL ARTWORK, in the slot this layout left for it.

        This was an emoji standing in "until ours are drawn" — they have been.
        Victor supplied both portraits on 14 Sep 2026; they arrived as 2.8 MB
        of PNG and are committed as 251 KB of WebP at q90, because brand art
        ships as WebP here (root CLAUDE.md) and the originals were over ten
        times the whole above-the-fold budget between them.

        The right-hand figure keeps this layout's existing horizontal flip, and
        it earns it: the two were not drawn as a pair — both look the same way,
        which from the right is out of frame and away from him. "she suppose to
        be looking at him not the other way round."
      */}
      <img
        src={art}
        alt=""
        aria-hidden
        draggable={false}
        loading="lazy"
        decoding="async"
        className={cn(
          'mb-[-4%] h-[62%] max-w-none object-contain object-bottom drop-shadow-[0_6px_10px_rgba(0,0,0,0.45)]',
          side === 'right' && 'scale-x-[-1]',
          won && 'drop-shadow-[0_0_18px_rgba(241,214,101,0.8)]',
        )}
      />
      <div className={cn('relative z-10 mb-[8%] flex', side === 'left' ? 'ml-[18%]' : 'mr-[18%]')}>
        {cards.length > 0
          ? cards.map((c, i) => (
              <div key={i} className={i > 0 ? '-ml-4 rotate-6' : '-rotate-6'}>
                <PlayingCard card={c} size="md" index={i} />
              </div>
            ))
          : [0, 1].map((i) => (
              <CardBack key={i} className={cn('h-16 w-12', i > 0 ? '-ml-5 rotate-6' : '-rotate-6')} />
            ))}
      </div>
      {hand && (
        <div
          className="absolute bottom-1 z-20 rounded px-1.5 text-[0.7rem]"
          style={{ background: 'rgba(0,0,0,0.6)', color: CREAM }}
        >
          {hand}
        </div>
      )}
    </div>
  );
}

/**
 * One market: a dark header strip carrying the chips on it, the name and odds, and underneath
 * either its recent trail or how long it has gone without paying.
 */
function MarketCell({
  label,
  odds,
  pool,
  yours,
  trail,
  vacant,
  showTrail,
  open,
  small,
  onBet,
}: {
  label: string;
  odds: number;
  pool: number;
  yours: number;
  trail: boolean[] | undefined;
  vacant: { rounds: number; exact: boolean } | undefined;
  showTrail: boolean;
  open: boolean;
  small: boolean;
  onBet: () => void;
}) {
  const longShot = odds >= LONG_SHOT;

  return (
    <button
      type="button"
      disabled={!open}
      onClick={onBet}
      className={cn(
        'relative flex min-w-0 flex-col border-r last:border-r-0 transition disabled:cursor-default',
        open && 'hover:bg-white/5 active:bg-white/10',
        yours > 0 && 'bg-[#f1d665]/12',
      )}
      style={{ borderColor: `${GOLD}66`, background: yours > 0 ? undefined : 'rgba(255,255,255,0.025)' }}
    >
      {/* Header strip — where the chips on this bet show. */}
      <div
        className="flex h-6 items-center justify-center gap-1.5 px-1 text-[0.7rem] tabular-nums"
        style={{ background: 'rgba(0,0,0,0.28)', color: CREAM }}
      >
        {pool > 0 && <span className="opacity-80">{pool}</span>}
        {yours > 0 && (
          <span className="rounded-full px-1.5 font-semibold" style={{ background: '#f1d665', color: '#5c3a12' }}>
            {yours}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-1 py-2.5 text-center">
        <span
          className={cn('leading-tight font-semibold', small ? 'text-[0.82rem]' : 'text-[1.1rem]')}
          style={{ color: CREAM }}
        >
          {label}
        </span>
        <span className="mt-1.5 text-[1.15rem] leading-none font-semibold tabular-nums" style={{ color: CREAM }}>
          {odds}x
        </span>
      </div>

      {showTrail && (
        <div className="flex h-4 items-center justify-center overflow-hidden px-1 pb-1">
          {longShot ? (
            vacant && vacant.rounds > 0 ? (
              <span className="text-[0.66rem] whitespace-nowrap" style={{ color: GOLD, fontFamily: 'var(--font-sans)' }}>
                {vacant.rounds}
                {vacant.exact ? '' : '+'} hands vacant
              </span>
            ) : null
          ) : (
            <div className="flex gap-[3px]">
              {(trail ?? []).slice(-12).map((hit, i) => (
                <span
                  key={i}
                  className="size-[7px] shrink-0 rounded-full"
                  style={{ background: hit ? '#e8956b' : 'rgba(170,176,172,0.75)' }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </button>
  );
}
