import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { PlayerSeat } from './PlayerSeat';
import { PlayingCard } from './PlayingCard';
import { ChipsToPot } from './ChipsToPot';
import { PotToWinner } from './PotToWinner';
import { chips } from '@/lib/money';
import { ChipStack } from './ChipStack';
import type { TableState } from '@/lib/table';
import { ringFor, type TableDesign } from '@/lib/tableDesigns';
import { useTableDesign } from '@/store/tableDesign';
import { cn } from '@/lib/cn';
import { PERMANENT_DOMAIN } from '@/config';

/**
 * The table: the chosen design's artwork with the seats placed on its rail and the board across the
 * felt.
 */

/**
 * ONE DESIGN SIZE, SCALED TO FIT — the fix for "In a smaller screen, it's
 * squeezing and not well done" (owner, 16 Sep 2026).
 *
 * The felt used to be sized to the space it had while its CONTENTS kept pixel
 * floors: a 44px minimum avatar, a 74px name pill, 44px cards. On a narrow
 * window the table shrank and those did not, so seats, pills and the board all
 * landed on each other.
 *
 * Now the table is laid out ONCE at this nominal width and scaled as a whole.
 * Every proportion is fixed at the size it was tuned at, and a small screen
 * gets the same table, smaller — which is what a native poker client does.
 */
const NOMINAL_W = 440;

/**
 * Room for what deliberately hangs past the felt's edge: the middle seats sit
 * at a 6% inset, so half an avatar, its name pill and an action bubble sit
 * outside the box. Counted into the fit so nothing is cut off.
 */
const BLEED = 26;

/** Beyond this the table stops growing — a felt the width of a desktop monitor is not a table. */
const MAX_SCALE = 1.8;

interface PokerTableProps {
  state: TableState;
  /** Live tables: tapping an open chair sits you down (called with the SERVER seat index). */
  onSit?: (seatIndex: number) => void;
  onChallenge?: (playerId: string) => void;
  /** Override the player's chosen design — used by the design picker's previews. */
  design?: TableDesign;
  /**
   * The table's identity, printed faintly across the felt like the reference
   * app does — name, invitation code (the shareable id), blinds. Shown while
   * the felt is empty; the board covers that spot once cards are out.
   */
  info?: { name: string; tableId: string; smallBlind: number; bigBlind: number };
}

export function PokerTable({ state, onSit, onChallenge, design: override, info }: PokerTableProps) {
  const { t } = useTranslation();
  const chosen = useTableDesign((s) => s.design);
  const design = override ?? chosen;
  const positions = ringFor(design, Math.max(2, state.seats.length));

  /**
   * YOU SIT AT THE BOTTOM, whichever chair the server gave you (owner, 15 Sep
   * 2026: "any body that joins should be at the bottom").
   *
   * Every ring's position 0 is the bottom centre, but seats were placed by
   * their SERVER index — so a player in chair 6 sat at the side, their hole
   * cards under the board. The ring is now rotated so the hero's chair lands on
   * position 0 and everyone else keeps their order around the table. The seat
   * indices themselves are untouched: `onSit` still sends the real chair.
   *
   * Found by `isHero`, not `heroSeat`, which reads 0 for a spectator too. A
   * spectator has no edge to rotate to, so the table shows as numbered.
   * Mobile does the same (mobile/src/components/poker/PokerTable.tsx).
   */
  const heroIndex = state.seats.findIndex((s) => s.isHero);
  const ringSize = Math.max(2, state.seats.length);
  const posFor = (i: number) =>
    positions[heroIndex < 0 ? i : (i - heroIndex + ringSize) % ringSize] ?? positions[0]!;

  /**
   * Is a hand running? The live feed sends '—' as the hand id between hands
   * (useLiveTable); cards on the board or chips in the pot settle it either way,
   * and cover the demo engine, which always has a hand id.
   */
  const inHand = state.handId !== '—' || state.board.length > 0 || state.pot > 0;


  // Whose turn it is, read off the seat the feed already marks — no new prop,
  // and no second opinion about who is to act. Rendered on the felt below.
  const toActSeat = state.seats.find((s) => s.status === 'toact');
  const turnName = toActSeat?.name ?? null;
  const heroToAct = Boolean(toActSeat?.isHero);

  /**
   * Where a seat falls in the DEALING order — first seat after the button, and
   * round from there.
   *
   * Hole cards already animated in, but every seat animated at the same
   * instant, so a deal read as "the cards were simply there". Victor: "it
   * didn't even show how the cards were shuffled among players, it just gave
   * card." Offsetting each seat by its distance from the button makes the deal
   * travel round the table the way a live one does.
   *
   * Falls back to raw seat order when no button is set (the demo engine, and
   * any feed that has not sent one yet) — a deal in table order still looks
   * dealt, which is the point.
   */
  /**
   * Seconds left on the acting player's clock, ticking once a second.
   *
   * The seat avatar already draws a draining ring, but it is a hairline on a
   * 44px circle and Victor's reading of it was "it doesn't even give me time
   * to play" — the clock was there and unreadable, which for a 20s decision is
   * the same as not having one. This puts the number itself on the felt.
   *
   * The ticker only runs while somebody is actually on the clock, so an idle
   * table is not re-rendering every second for nothing.
   */
  const deadline = toActSeat?.deadline ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  const secondsLeft = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;

  const buttonSeat = state.seats.findIndex((s) => s.isDealer);
  const dealOrder = (i: number): number => {
    const n = state.seats.length;
    if (n === 0) return 0;
    if (buttonSeat < 0) return i;
    return (i - buttonSeat - 1 + n * 2) % n;
  };

  // "1672 / 941" → wider than tall. Short Deck is landscape; everything else is
  // portrait, and the two want different width ceilings.
  const [aw = '1', ah = '1'] = design.aspect.split('/').map((n) => n.trim());
  const isWide = Number(aw) > Number(ah);

  /** The table's own height at NOMINAL_W, from the design's aspect ratio. */
  const nominalH = Math.round((NOMINAL_W * Number(ah)) / Number(aw));

  /**
   * How much of that nominal table fits the space this component was given.
   *
   * Measured rather than computed in CSS: a scale factor is a ratio of two
   * lengths, and CSS cannot divide one length by another. A ResizeObserver
   * keeps it right through a rotation, a keyboard opening, or a desktop window
   * being dragged narrower — which is exactly when the old layout collapsed.
   */
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = (w: number, h: number): void => {
      if (w <= 0 || h <= 0) return;
      setScale(Math.min(w / (NOMINAL_W + BLEED * 2), h / (nominalH + BLEED * 2), MAX_SCALE));
    };
    fit(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) fit(rect.width, rect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [nominalH]);

  return (
    <div
      ref={boxRef}
      className={cn('relative mx-auto flex h-full w-full items-center justify-center', isWide && 'px-0')}
    >
      {/*
        The table itself, at its design size. `container-type: size` makes this
        box the reference for everything positioned inside it — seats in `cqmin`,
        board cards in `cqw` — so those all resolve against a box that never
        changes, and the transform below does the fitting.
      */}
      <div
        className="relative shrink-0"
        style={{
          width: NOMINAL_W,
          height: nominalH,
          transform: `scale(${scale})`,
          containerType: 'size',
        }}
      >

        {/* Embedded HTML5 Canvas Element for inspection */}
        <canvas
          id="poker-table-canvas"
          className="absolute inset-0 size-full pointer-events-none rounded-[50%] z-0"
        />

        {/* NO TABLE SURFACE.
            Owner's call (11 Sep 2026): "remove the table, leave it plain
            background... and just put the sit here around it like an oval but
            no table on it", and when asked whether that meant one new plain
            design or all of them: "all table design goes".

            So neither the artwork nor the CSS felt is drawn. The seats keep
            their ring — those positions were MEASURED against the artwork, and
            they are what makes the oval an oval — but nothing is rendered
            behind them. The screen's own background shows through.

            `ringFor(design, …)` above is therefore now the only thing the
            design object is consulted for: geometry, not appearance.

            What IS drawn is the reference's deep red ground. Removing the felt
            first left the app's near-black background showing through —
            Victor: "why is it blaclk instead of red". It is a plain gradient,
            not a table: no rail, no edge, no oval. The seats make the oval. */}
        {/* RED. Desaturating this toward the reference screenshot's dusty
            rose-brown was tried once and reverted — on screen it read as
            washed-out grey-mauve with the red gone ("what is this change it
            back to red"). The screenshot's muted look is the phone's own
            rendering; sampling it literally loses the colour. */}
        {/* NO GROUND HERE ANY MORE. The SCREEN paints it (see Table.tsx), so
            painting it again inside the felt's box drew a second radial
            gradient inside the first — a visible ellipse floating on the page's
            own. Victor: "it should be one whole back ground complete". One
            surface, painted once, at the top. */}

        {/*
          THE CARD ROW IS KEPT CLEAR. The table's identity and the wordmark used
          to be centred on the felt — exactly where the board deals — so the
          text sat over the card slots (owner, 15 Sep 2026: "covering where the
          cards will display"). Now the identity sits ABOVE the row and the
          wordmark BELOW it, and nothing is printed on the row itself.
        */}

        {/* The table's identity: name between asterisks, table number, blinds,
            and our host — read from the page, never hardcoded. WHITE and faint:
            the reference shows this as light type on a dark ground. Only while
            no hand is running; during a hand the pot takes this spot. */}
        {info && !inHand && (
          <div
            className="pointer-events-none absolute left-1/2 z-[5] -translate-x-1/2 -translate-y-full text-center text-[3.2cqmin] leading-relaxed whitespace-nowrap text-white/30"
            style={{ top: `calc(${design.boardTop} - 2.75rem)` }}
          >
            <div className="font-semibold">* {info.name} *</div>
            <div>#{info.tableId}</div>
            <div>
              {t('tableEntry.stakesBlurb', {
                stakes: `${info.smallBlind}/${info.bigBlind}`,
              })}
            </div>
            <div>www.{PERMANENT_DOMAIN}</div>
          </div>
        )}

        {/* The wordmark, faded DARK — pressed into the ground as on the
            reference, not a pale watermark. Below the card row, and under
            everything else (z-[5], no pointer events). */}
        <div
          className="pointer-events-none absolute left-1/2 z-[5] -translate-x-1/2 select-none text-[10cqmin] font-black tracking-[0.06em] text-[#1a1012]/45"
          style={{ top: `calc(${design.boardTop} + 3rem)` }}
        >
          MYPOKER
        </div>

        {/* Board + pot, across the middle of the felt */}
        <div
          className="absolute left-1/2 flex w-full -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 z-10"
          style={{ top: design.boardTop }}
        >
          <div className="flex flex-col items-center gap-1.5">
            {state.pot > 0 && (
              <div
                className="rounded-full border border-white/15 bg-black/55 px-3 py-0.5 text-[0.65rem] font-bold tracking-widest backdrop-blur-sm"
                style={{ color: design.accent }}
              >
                POT {chips(state.pot)}
              </div>
            )}
            <ChipStack amount={state.pot} hideLabel />
          </div>

          <div className="flex gap-1 sm:gap-1.5">
            {state.board.map((c, i) => (
              <PlayingCard key={c} card={c} size="board" index={i} />
            ))}
            {/* Streets still to come — only during a hand. On an idle table five
                empty dashed boxes were just outlines of nothing. */}
            {inHand && Array.from({ length: 5 - state.board.length }).map((_, i) => (
              <div
                key={`slot-${i}`}
                // Same box as a `board` card, so a dealt card lands exactly on its slot.
                className="aspect-[11/16] w-[min(2.75rem,calc((71cqw_-_40px)/5))] shrink-0 rounded-lg border border-dashed border-white/15 bg-white/[0.03]"
              />
            ))}
          </div>

          {/*
            Who won, directly under the board.

            It used to be a banner BELOW the whole felt, down among the action
            bar and the chat button — so the one line explaining what just
            happened sat furthest from the cards it was explaining, in the most
            crowded part of the screen. Here it lands where the player is
            already looking when the hand resolves.
          */}
          {/*
            Whose turn it is, on the felt.

            This used to live ONLY in the status line under the table, next to
            Rebuy / Sit out / Leave — dim, small, and in the one part of the
            screen nobody watches while a hand is running. Victor's words: "this
            is showing where no one will see it". Same fix, and same reasoning,
            as the winner banner directly below: the line explaining what the
            table is waiting for belongs where the player is already looking.

            Hidden once the hand is over, so it cannot argue with that banner —
            they occupy the same spot, and "X's turn" under a finished hand is
            just wrong.
          */}
          <AnimatePresence>
            {!state.handOver && turnName && (
              <motion.div
                key="turn"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="max-w-[85%] truncate rounded-full border border-white/15 bg-black/60 px-3 py-0.5 text-center text-[0.68rem] font-bold tracking-wide text-white/90 shadow backdrop-blur-sm"
              >
                {heroToAct ? t('table.yourTurn') : t('table.playerTurn', { name: turnName })}
                {secondsLeft !== null && (
                  // Amber under 5s. The colour is the only warning a player
                  // glancing at the felt will register in time.
                  <span
                    className={cn(
                      'ml-1.5 tabular-nums',
                      secondsLeft <= 5 ? 'text-warn' : 'text-white/55',
                    )}
                  >
                    {secondsLeft}s
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {state.handOver && state.message && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                className="max-w-[85%] rounded-full border border-white/15 bg-black/70 px-3.5 py-1 text-center text-[0.72rem] font-bold text-white shadow-lg backdrop-blur-sm"
              >
                {state.message}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Chips sweeping into the pot when a street ends. */}
        <ChipsToPot
          street={state.street}
          bets={state.seats.map((seat, i) => ({
            seatIndex: i,
            amount: seat.bet,
            from: posFor(i),
          }))}
        />

        {/* The pot travelling back out to whoever won it. */}
        <PotToWinner
          handId={state.handId}
          amount={state.pot}
          winners={state.seats
            .map((seat, i) => (seat.isWinner ? posFor(i) : null))
            .filter((p): p is NonNullable<typeof p> => p !== null)}
          youWon={state.seats.some((seat) => seat.isWinner && seat.isHero)}
        />

        {/* Seats */}
        {state.seats.map((seat, i) => {
          const pos = posFor(i);
          return (
            <div
              key={`${seat.id}-${i}`}
              // YOUR seat draws over every other seat. Seats render in chair
              // order at one z-index, so a later chair painted over your hole
              // cards wherever the two met ("I can't even make out the hole
              // cards").
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2',
                seat.isHero ? 'z-30' : 'z-20',
              )}
              style={{ left: pos.left, top: pos.top }}
            >
              <PlayerSeat
                seat={seat}
                align={pos.align}
                accent={design.accent}
                dealOrder={dealOrder(i)}
                onSit={onSit ? () => onSit(i) : undefined}
                onClick={() => {
                  if (seat.status !== 'empty' && onChallenge && seat.playerId && !seat.isHero) {
                    onChallenge(seat.playerId);
                  }
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The fallback table, built from the brand tokens — no image required. */
/**
 * The felt, drawn rather than photographed.
 *
 * Takes its palette from the design so a CSS table is not locked to the brand's
 * violet. `house-maroon` is the reference table's burgundy; anything without a
 * `cssFelt` keeps exactly the colours this used to hardcode, so Neon is
 * untouched.
 */
