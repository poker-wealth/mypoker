import { useEffect, useState } from 'react';
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

  // Mobile keeps the 440px felt; desktop scales it up so the table fills the
  // screen instead of sitting as a small oval in a sea of empty space. The felt
  // is aspect-ratio + %-positioned, so the whole table (seats) scales together.
  return (
    <div
      className={cn(
        'relative mx-auto flex w-full items-center justify-center',
        // A LANDSCAPE felt is short, so it can afford to be much wider — capping
        // it at the portrait width leaves a cramped strip with the seats
        // crowding each other. A portrait felt keeps the original ceiling,
        // because widening that one only makes it taller than the screen.
        //
        // The PADDING matters more than the cap on a phone: at 360px wide the
        // ceiling is never reached, and 20px of gutter each side is 11% of the
        // felt. A wide table gets almost none — it has vertical room to spare
        // and needs every pixel of width.
        isWide
          ? 'px-0 max-w-none md:max-w-[1100px] lg:max-w-[1400px]'
          : 'px-5 max-w-[440px] md:max-w-[620px] lg:max-w-[780px]',
      )}
    >
      {/*
        `container-type: size` makes this box the reference for the seats.

        Seat avatars were a fixed 56–62px while the felt scaled with the screen,
        which is fine on a tall portrait table and wrong on a short landscape
        one: the same circle that reads as a chair on a 780px-high felt covers a
        quarter of a 250px-high one. Sizing them in `cqmin` — a share of the
        table's SHORTER side — keeps a seat the same fraction of the table on
        any felt, in either orientation.
      */}
      <div
        className="relative w-full"
        style={{ aspectRatio: design.aspect, containerType: 'size' }}
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
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_center,#6d2230_0%,#4a1622_45%,#2a0d14_100%)]"
        />

        {/* The brand across the felt, as on the reference table. Always there,
            faint, under the board — a watermark, not a message. */}
        <div className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center">
          {/* WHITE, not black, here and on the wordmark below. Both were
              `text-black/…`, which was right while a bright felt sat behind
              them and is invisible now the felt is gone — the table renders on
              the app's near-black background. The reference shows this block as
              faint LIGHT type on a dark ground. */}
          {info && state.board.length === 0 && (
            <div className="mb-[2cqmin] text-center text-[3.2cqmin] leading-relaxed text-white/30">
              {/* The reference's centre block, ours: the name between asterisks,
                  the table number (which IS the invitation code here — the
                  share link is /table/<id>), the blinds, and OUR host — read
                  from the page, never hardcoded, so it is always the domain
                  the app is actually served on. */}
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
          <div className="select-none text-[10cqmin] font-black tracking-[0.06em] text-white/[0.13]">
            MYPOKER
          </div>
        </div>

        {/* MYPY in the corner, as the reference table keeps its mascot.
            Decoration only — it takes no taps and promises nothing. */}
        <img
          src="/brand/logo-icon.png"
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute bottom-[2cqmin] left-[2.5cqmin] z-[6] w-[11cqmin] select-none opacity-90 drop-shadow-lg"
        />

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
              <PlayingCard key={c} card={c} size="md" index={i} />
            ))}
            {/* Streets still to come */}
            {Array.from({ length: 5 - state.board.length }).map((_, i) => (
              <div
                key={`slot-${i}`}
                className="h-16 w-11 rounded-lg border border-dashed border-white/15 bg-white/[0.03]"
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
            from: positions[i] ?? positions[0]!,
          }))}
        />

        {/* The pot travelling back out to whoever won it. */}
        <PotToWinner
          handId={state.handId}
          amount={state.pot}
          winners={state.seats
            .map((seat, i) => (seat.isWinner ? (positions[i] ?? positions[0]!) : null))
            .filter((p): p is NonNullable<typeof p> => p !== null)}
          youWon={state.seats.some((seat) => seat.isWinner && seat.isHero)}
        />

        {/* Seats */}
        {state.seats.map((seat, i) => {
          const pos = positions[i] ?? positions[0]!;
          return (
            <div
              key={`${seat.id}-${i}`}
              className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
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
