import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { PlayingCard } from '@/components/poker/PlayingCard';
import type { TableCommand, TableSnapshot } from '@/lib/liveTable';
import { BoardPanel, BetRow, BetCell } from './texascowboy/BetPanel';
import { cn } from '@/lib/cn';

/**
 * TEXAS COWBOY — a betting board, not a poker seat.
 *
 * Two hands are dealt, Cowboy and Cowgirl, and nobody plays them: the table
 * bets on the outcome. So the screen reads top to bottom — the two of them
 * facing each other with the board between, then the markets. Tap a chip, tap a
 * market, the bet is placed; there is no confirm step, because a window that
 * closes in twelve seconds cannot afford one.
 *
 * BUILT TO THE REFERENCE Victor supplied (14 Sep 2026): the characters at the
 * top facing in, the community cards between them, then bordered panels of
 * markets with a gold side-label per group and a big multiplier in each cell,
 * and a single gold "Join Game" across the foot.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE PLACES THIS DELIBERATELY DIVERGES, all for the same reason — the
 * reference draws things our server does not send:
 *
 *   THE SURFACE IS THE PLAYER'S, NOT THIS GAME'S. The reference is green
 *   felt with cream market cards, and both were built and both were rejected:
 *   green first ("what is this"), then the cream band ("remove that cream"),
 *   then the green again the moment it was seen over a blue ground — "on blue
 *   background its still showing green".
 *
 *   That is the settled rule for every felt in this app and this board is not
 *   an exception: the LAYOUT is copied from the reference, the COLOUR comes
 *   from whatever ground the player picked, and the panels are translucent so
 *   it shows through and tints them.
 *
 *   NO CAPACITY DOTS. Each reference cell carries a row of dots and a line like
 *   "276 hands vacant" — how much of that market is still open to back. Our
 *   markets are uncapped and the server publishes no such limit, so the cells
 *   carry what is real instead: the chips the table has on them and the chips
 *   you have.
 *
 *   MARKETS ARE NOT COMBINED. The reference sells "Three of a kind / Straight /
 *   Flush" as ONE bet at 4.5x. Our server settles those as three separate
 *   markets, so they are three cells. Drawing them as one would take a single
 *   tap and place it on whichever of the three this file guessed.
 *
 * The server owns every number. The felt never multiplies anything out except
 * to preview a return.
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

/**
 * The board, in the reference's three bands.
 *
 * Band one is the duel itself and carries no side-label, like the reference.
 * The other two are grouped under a gold label. Every id here is a market the
 * server actually settles — see the note at the top about not merging them.
 */
const BANDS: Array<{ labelKey?: string; rows: string[][] }> = [
  // The duel: three across, as the reference has it.
  { rows: [['cowboy_win', 'tie', 'cowgirl_win']] },
  // Either hand type — the DEALT cards. One market across the full width, then
  // a pair beneath: the reference's shape exactly, because these are now the
  // reference's markets.
  {
    labelKey: 'cowboy.eitherHand',
    rows: [['suited_connects'], ['pocket_pair', 'pocket_aces']],
  },
  // Winning hand rank — a row of two over a row of three, exactly as the
  // reference lays it out, now that the hand types are grouped the way it
  // prices them.
  {
    labelKey: 'cowboy.winningRank',
    rows: [
      ['high_card_or_pair', 'two_pair'],
      ['trips_straight_flush', 'full_house', 'quads_or_better'],
    ],
  },
];

const CHIPS = [100, 500, 1_000, 5_000];

const titleOf = (id: string): string =>
  id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

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
  const { t } = useTranslation();
  const [chip, setChip] = useState<number>(100);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
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

  const marketOf = (id: string) => round?.markets.find((m) => m.id === id);
  const poolOf = (id: string): number => round?.pools?.[id] ?? 0;
  const yoursOn = (id: string): number => round?.yourStakes?.[id] ?? 0;

  const bet = (marketId: string): void => {
    if (!isBettingOpen || !you) return;
    onCommand?.({ kind: 'act', action: { type: 'bet', amount: chip, selection: marketId } });
  };

  /** The market that just won, so its cell can be marked. */
  const wonMarket =
    round?.result === null || round?.result === undefined
      ? null
      : round.result.winner === 'COWBOY'
        ? 'cowboy_win'
        : round.result.winner === 'COWGIRL'
          ? 'cowgirl_win'
          : 'tie';

  return (
    /* NO COLOUR OF ITS OWN. The player's chosen ground shows through every
       panel here — see the note at the top. */
    <div className="relative flex min-h-[40rem] w-full flex-col self-stretch overflow-hidden text-white select-none">
      {/* ── THE SCENE ─────────────────────────────────────────────────────────
          The two of them facing in, the board dealt between them, the clock
          above. The reference puts the characters large and edge-to-edge; they
          are cropped by the panel rather than scaled down, which is what keeps
          them looking painted on rather than pasted in. */}
      <div className="relative h-56 shrink-0 overflow-hidden bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.18)_0%,rgba(0,0,0,0.45)_75%)]">
        <Duelist
          side="left"
          art="/brand/cowboy.webp"
          name={t('cowboy.cowboy')}
          cards={round?.cowboy.holeCards ?? []}
          hand={round?.cowboy.evaluation?.displayName}
          won={round?.result?.winner === 'COWBOY'}
        />
        <Duelist
          side="right"
          art="/brand/cowgirl.webp"
          name={t('cowboy.cowgirl')}
          mirror
          cards={round?.cowgirl.holeCards ?? []}
          hand={round?.cowgirl.evaluation?.displayName}
          won={round?.result?.winner === 'COWGIRL'}
        />

        {/* The clock */}
        <div className="absolute top-2 left-1/2 z-20 -translate-x-1/2">
          {remaining > 0 && isBettingOpen ? (
            <div
              className={cn(
                'grid h-12 w-12 place-items-center rounded-full border-[3px] text-base font-black tabular-nums',
                remaining > 3_000
                  ? 'border-[#e8c06a] bg-black/55 text-[#ffd97a]'
                  : 'animate-pulse border-rose-500 bg-black/55 text-rose-300',
              )}
            >
              {Math.ceil(remaining / 1_000)}
            </div>
          ) : (
            <div className="rounded-full bg-black/60 px-3 py-1 text-[0.66rem] font-black tracking-wider text-[#e8c06a]">
              {round?.phase === 'SETTLED' ? t('cowboy.settled') : t('cowboy.betsClosed')}
            </div>
          )}
        </div>

        {/* The community cards, dealt between them. */}
        <div className="absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 gap-1">
          {Array.from({ length: 5 }, (_, i) => {
            const card = round?.communityCards[i];
            return <PlayingCard key={i} {...(card ? { card } : {})} size="sm" index={i} />;
          })}
        </div>

        {/* The road: how the last rounds went. */}
        <div className="absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 px-3 py-1">
          <span className="mr-1 text-[0.58rem] font-bold tracking-wider text-[#e8c06a]/75">
            #{round?.roundNumber ?? '—'}
          </span>
          {(round?.history ?? []).slice(-14).map((w, i) => (
            <span
              key={i}
              title={w}
              className={cn(
                'h-2 w-2 rounded-full',
                w === 'COWBOY' ? 'bg-amber-400' : w === 'COWGIRL' ? 'bg-rose-400' : 'bg-emerald-300',
              )}
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
            className="absolute top-24 left-1/2 z-50 -translate-x-1/2 rounded-2xl border-2 border-[#e8c06a] bg-black/80 px-8 py-4 text-center backdrop-blur-md"
          >
            <div className="text-2xl font-black tracking-tight uppercase">
              {round.result.winner === 'TIE'
                ? t('cowboy.push')
                : t('cowboy.wins', { who: t(`cowboy.${round.result.winner === 'COWBOY' ? 'cowboy' : 'cowgirl'}`) })}
            </div>
            {round.result.winningHandType && (
              <div className="mt-1 text-sm font-bold text-[#ffd97a]">
                {titleOf(round.result.winningHandType)}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── THE BOARD ─────────────────────────────────────────────────────────
          Bordered panels, a gold side-label per group, a big multiplier per
          cell — the reference's shape, carrying our real markets. */}
      <div className="relative z-10 flex flex-1 flex-col gap-1.5 px-1.5 py-2">
        {BANDS.map((band, i) => (
          <BoardPanel key={i} {...(band.labelKey ? { label: t(band.labelKey) } : {})}>
            {band.rows.map((row, r) => (
              <BetRow key={r}>
                {row.map((id) => {
                  const market = marketOf(id);
                  return (
                    <BetCell
                      key={id}
                      name={market?.name ?? titleOf(id)}
                      multiplier={market?.multiplier ?? null}
                      pool={poolOf(id)}
                      yours={yoursOn(id)}
                      onBet={() => bet(id)}
                      disabled={!isBettingOpen || !you || market?.enabled === false}
                      won={wonMarket === id}
                      poolLabel={t('cowboy.poolShort')}
                      yoursLabel={t('cowboy.yoursShort')}
                    />
                  );
                })}
              </BetRow>
            ))}
          </BoardPanel>
        ))}
      </div>

      {/* ── THE FOOT ──────────────────────────────────────────────────────────
          Seated, it is the chip tray. Not seated, it is the reference's single
          gold Join Game — because until you are in, nothing above can be
          tapped, and a tray of chips over a board you cannot bet on is a
          control that does nothing. */}
      <div className="relative z-10 shrink-0 px-3 pt-1 pb-3">
        {you ? (
          <div className="flex items-center justify-center gap-2">
            {CHIPS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setChip(value)}
                className={cn(
                  'h-11 w-11 rounded-full border-2 text-[0.62rem] font-black tabular-nums transition active:scale-95',
                  chip === value
                    ? 'border-[#ffd97a] bg-[#e8c06a] text-black'
                    : 'border-[#d9b87c]/40 bg-black/40 text-[#e8c06a]',
                )}
              >
                {value >= 1_000 ? `${value / 1_000}K` : value}
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={sitDown}
            className="w-full rounded-full bg-[linear-gradient(180deg,#f0d493,#d9b87c)] py-3 text-sm font-black tracking-wide text-[#4a3312] transition active:scale-[0.99]"
          >
            {t('cowboy.joinGame')}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * One of the two characters, with their hole cards.
 *
 * The art is a PORTRAIT with a transparent background, so it is anchored to the
 * bottom of the panel and allowed to crop — scaling it to fit would leave a
 * small figure floating in the middle of the felt.
 *
 * `mirror` FLIPS THE PICTURE so the two face each other. The source portraits
 * were not drawn as a pair: the cowboy looks to his right, which is inward from
 * the left side, but the cowgirl looks the same way — which from the right side
 * is out of the frame, away from him. Victor: "she suppose to be looking at him
 * not the other way round." Flipping her costs nothing (the art is symmetric in
 * everything but direction) and is the only way to make them a duel rather than
 * two people ignoring each other.
 */
function Duelist({
  side,
  art,
  name,
  cards,
  hand,
  won,
  mirror,
}: {
  side: 'left' | 'right';
  art: string;
  name: string;
  cards: string[];
  hand?: string | undefined;
  won?: boolean;
  /** Flip horizontally, so a portrait drawn facing one way faces the other. */
  mirror?: boolean;
}) {
  return (
    <div
      className={cn(
        'absolute bottom-0 z-0 flex h-full w-[30%] flex-col justify-end',
        side === 'left' ? 'left-0 items-start' : 'right-0 items-end',
      )}
    >
      <img
        src={art}
        alt=""
        aria-hidden
        draggable={false}
        loading="lazy"
        decoding="async"
        className={cn(
          'pointer-events-none absolute bottom-0 h-[92%] w-full object-contain transition-opacity',
          side === 'left' ? 'left-0 object-left-bottom' : 'right-0 object-right-bottom',
          mirror && '-scale-x-100',
          won ? 'opacity-100' : 'opacity-85',
        )}
      />

      {/* Name and hand sit ON the art, so they are on a scrim rather than
          competing with it. */}
      <div
        className={cn(
          'relative z-10 m-1.5 max-w-[92%] rounded-md bg-black/55 px-2 py-1 backdrop-blur-[2px]',
          won && 'ring-1 ring-[#e8c06a]',
        )}
      >
        <div className="text-[0.62rem] leading-tight font-black tracking-wider text-[#e8c06a]">
          {name}
        </div>
        {hand && <div className="text-[0.58rem] leading-tight text-white/75">{hand}</div>}
      </div>

      <div className={cn('relative z-10 mb-1 flex gap-0.5', side === 'left' ? 'ml-1.5' : 'mr-1.5')}>
        {Array.from({ length: 2 }, (_, i) => {
          const card = cards[i];
          return <PlayingCard key={i} {...(card ? { card } : {})} size="sm" index={i} />;
        })}
      </div>
    </div>
  );
}
