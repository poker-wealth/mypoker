import { useState } from 'react';
import { PlayerSeat } from './PlayerSeat';
import { PlayingCard } from './PlayingCard';
import { ChipStack } from './ChipStack';
import type { TableState } from '@/lib/table';
import { ringFor, type TableDesign } from '@/lib/tableDesigns';
import { useTableDesign } from '@/store/tableDesign';

/**
 * The table: the chosen design's artwork with the seats placed on its rail and the board across the
 * felt.
 *
 * Portrait is the shape all the designs share — a phone held upright gives a tall playing area, so
 * the felt fills the screen instead of floating in it and the seats stay far enough apart to read
 * at thumb size. Everything specific to a particular table (proportions, where the chairs sit, the
 * accent colour) comes from `lib/tableDesigns.ts`; this component only knows how to lay it out.
 *
 * If a design's image fails to load, the CSS surface takes over, so a missing or renamed file can
 * never leave a player staring at a blank screen mid-hand.
 */

interface PokerTableProps {
  state: TableState;
  /** Live tables: tapping an open chair sits you down (called with the SERVER seat index). */
  onSit?: (seatIndex: number) => void;
  /** Override the player's chosen design — used by the design picker's previews. */
  design?: TableDesign;
}

export function PokerTable({ state, onSit, design: override }: PokerTableProps) {
  const chosen = useTableDesign((s) => s.design);
  const design = override ?? chosen;
  const positions = ringFor(design, Math.max(2, state.seats.length));

  const [failed, setFailed] = useState<string | null>(null);
  const useArt = Boolean(design.artUrl) && failed !== design.artUrl;

  return (
    <div className="relative mx-auto flex w-full max-w-[440px] items-center justify-center px-5">
      <div className="relative w-full" style={{ aspectRatio: design.aspect }}>

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
          className="absolute left-1/2 flex w-full -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3"
          style={{ top: design.boardTop }}
        >
          <div className="flex flex-col items-center gap-1.5">
            {state.pot > 0 && (
              <div
                className="rounded-full border border-white/15 bg-black/55 px-3 py-0.5 text-[0.65rem] font-bold tracking-widest backdrop-blur-sm"
                style={{ color: design.accent }}
              >
                POT ₮{state.pot.toLocaleString()}
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
        </div>

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
                {...(onSit ? { onSit: (): void => onSit(seat.id) } : {})}
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
