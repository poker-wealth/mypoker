import { cn } from '@/lib/cn';

/**
 * The betting board's building blocks, laid out the way the reference does it:
 * bordered panels, a gold label down the left of a group, and inside each cell
 * the market's name over a big multiplier.
 *
 * WHAT THE REFERENCE SHOWS IN EACH CELL that this does not: a row of coloured
 * dots and a line like "276 hands vacant". That is a CAPACITY meter — how much
 * of that market is still open to back. Our server publishes no such limit;
 * markets here are uncapped. Drawing the dots would be drawing a gauge with
 * nothing behind it, so the cell carries what we do have instead: the chips the
 * table has already put on it, and the chips you have.
 */

export function BoardPanel({
  label,
  children,
}: {
  /** The gold side-label, e.g. "Either hand type". Omitted for the top row. */
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex overflow-hidden rounded-lg border border-[#d9b87c]/45 bg-black/25">
      {label && (
        <div className="grid w-[4.5rem] shrink-0 place-items-center border-r border-[#d9b87c]/45 px-1 py-2 text-center">
          <span className="text-[0.66rem] leading-tight font-black text-[#e8c06a]">{label}</span>
        </div>
      )}
      {/*
        ROWS, NOT A UNIFORM GRID.

        This was a three-column grid, and before that a two-column one, and
        neither matched: the reference's bands are rows of DIFFERENT widths —
        'Either hand type' is one cell across the full width and then a row of
        two; 'Winning hand rank' is a row of two and then a row of three. A
        fixed column count cannot produce that, and with an odd market count it
        strands a cell on its own beside empty felt.

        So a band hands in its rows and each row divides itself evenly. The felt
        decides which markets share a row.
      */}
      <div className="flex flex-1 flex-col">{children}</div>
    </section>
  );
}

/** One row of a band. Its cells divide it evenly, whatever the count. */
export function BetRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 border-b border-[#d9b87c]/25 last:border-b-0">{children}</div>;
}

export function BetCell({
  name,
  multiplier,
  pool,
  yours,
  onBet,
  disabled,
  won,
  poolLabel,
  yoursLabel,
}: {
  name: string;
  /** The server's payout for this market. Null when it has not sent one. */
  multiplier: number | null;
  /** Chips the whole table has here. */
  pool: number;
  /** Chips you have here. */
  yours: number;
  onBet: () => void;
  disabled: boolean;
  /** This market just won. */
  won?: boolean;
  poolLabel: string;
  yoursLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onBet}
      disabled={disabled}
      className={cn(
        'relative flex flex-1 basis-0 min-h-[4.25rem] flex-col items-center justify-center gap-0.5 border-r border-[#d9b87c]/25 px-1.5 py-2 text-center transition',
        'last:border-r-0 disabled:cursor-default',
        !disabled && 'active:scale-[0.98] active:bg-white/[0.06]',
        won && 'bg-[#e8c06a]/20',
        yours > 0 && 'ring-1 ring-[#e8c06a]/60 ring-inset',
      )}
    >
      <span className="text-[0.62rem] leading-tight font-bold text-white/85">{name}</span>

      {/* The payout. An em dash when the server has not quoted one — never a
          zero, which on a betting board reads as "this pays nothing". */}
      <span className="text-[1.05rem] leading-none font-black text-[#ffd97a] tabular-nums">
        {multiplier === null ? '—' : `${multiplier}x`}
      </span>

      {/* Real money on the market, in place of the reference's capacity dots. */}
      <span className="flex items-center gap-1 text-[0.52rem] leading-none text-white/45">
        {pool > 0 && (
          <span className="tabular-nums">
            {poolLabel} {pool.toLocaleString()}
          </span>
        )}
        {yours > 0 && (
          <span className="font-bold text-[#e8c06a] tabular-nums">
            {yoursLabel} {yours.toLocaleString()}
          </span>
        )}
      </span>
    </button>
  );
}
