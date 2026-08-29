import { useState } from 'react';
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
}

export function PokerTable({ state, onSit, onChallenge, design: override }: PokerTableProps) {
  const chosen = useTableDesign((s) => s.design);
  const design = override ?? chosen;
  const positions = ringFor(design, Math.max(2, state.seats.length));

  const [failed, setFailed] = useState<string | null>(null);
  const useArt = Boolean(design.artUrl) && failed !== design.artUrl;

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
        'relative mx-auto flex w-full items-center justify-center px-5',
        // A LANDSCAPE felt is short, so it can afford to be much wider — capping
        // it at the portrait width leaves a cramped strip with the seats
        // crowding each other. A portrait felt keeps the original ceiling,
        // because widening that one only makes it taller than the screen.
        isWide
          ? 'max-w-[620px] md:max-w-[860px] lg:max-w-[1040px]'
          : 'max-w-[440px] md:max-w-[620px] lg:max-w-[780px]',
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

        {/* The table surface */}
        {useArt ? (
          <img
            src={design.artUrl!}
            alt=""
            aria-hidden
            draggable={false}
            onError={() => setFailed(design.artUrl)}
            className="absolute inset-0 h-full w-full select-none object-contain"
          />
        ) : (
          <CssTable />
        )}

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
function CssTable() {
  return (
    <>
      {/* Outer glow — the light the rail throws onto the background */}
      <div
        className="pointer-events-none absolute -inset-6 rounded-[50%] opacity-70 blur-2xl"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in srgb, var(--brand-2) 45%, transparent), transparent 75%)',
        }}
      />

      {/* Outer rail ring */}
      <div
        className="absolute inset-0 rounded-[50%]"
        style={{
          background: 'linear-gradient(160deg, var(--brand) 0%, var(--brand-2) 45%, var(--accent) 100%)',
          padding: '2px',
          boxShadow:
            '0 0 24px color-mix(in srgb, var(--brand-2) 55%, transparent), 0 0 60px color-mix(in srgb, var(--brand) 25%, transparent)',
        }}
      >
        <div className="h-full w-full rounded-[50%]" style={{ background: 'var(--bg)' }} />
      </div>

      {/* Inner rail ring */}
      <div
        className="absolute inset-[3.5%] rounded-[50%]"
        style={{
          background: 'linear-gradient(200deg, var(--accent) 0%, var(--brand-2) 50%, var(--brand) 100%)',
          padding: '2px',
          boxShadow: '0 0 18px color-mix(in srgb, var(--accent) 40%, transparent)',
        }}
      >
        <div
          className="relative h-full w-full overflow-hidden rounded-[50%]"
          style={{
            background:
              'radial-gradient(ellipse at 50% 42%, #1e3f74 0%, var(--felt) 45%, #0a162c 78%, #060d1c 100%)',
            boxShadow: 'inset 0 0 60px rgba(0,0,0,0.75), inset 0 2px 20px rgba(255,255,255,0.06)',
          }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.14] mix-blend-overlay"
            style={{
              backgroundImage: 'radial-gradient(#9fd0ff 0.5px, transparent 0.5px)',
              backgroundSize: '4px 4px',
            }}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="translate-y-[22%] text-2xl font-black tracking-[0.35em] text-white/[0.06] sm:text-3xl">
              FAIRPLAY
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

