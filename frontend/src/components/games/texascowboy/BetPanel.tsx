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
  cream,
  children,
}: {
  /** The reference's top band is a cream card; the grouped bands are green. */
  cream?: boolean;
  /** The gold side-label, e.g. "Either hand type". Omitted for the top row. */
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'flex overflow-hidden rounded-lg border',
        cream ? 'border-[#c9a45a] bg-[#f3ead0]' : 'border-[#d9b87c]/45 bg-[#1f5a42]/85',
      )}
    >
      {label && (
        <div className="grid w-[4.5rem] shrink-0 place-items-center border-r border-[#d9b87c]/45 px-1 py-2 text-center">
          <span className="text-[0.66rem] leading-tight font-black text-[#e8c06a]">{label}</span>
        </div>
      )}
      <div className="grid flex-1 grid-cols-2 sm:grid-cols-3">{children}</div>
    </section>
  );
}

export function BetCell({
  name,
  multiplier,
  pool,
  yours,
  onBet,
  disabled,
  wide,
  won,
  poolLabel,
  yoursLabel,
  cream,
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
  /** Spans the full row — used where a group has a single market. */
  wide?: boolean;
  /** This market just won. */
  won?: boolean;
  poolLabel: string;
  yoursLabel: string;
  /** Sits on the cream band, so its type has to be dark rather than white. */
  cream?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onBet}
      disabled={disabled}
      className={cn(
        'relative flex min-h-[4.25rem] flex-col items-center justify-center gap-0.5 border-r border-b border-[#d9b87c]/25 px-1.5 py-2 text-center transition',
        cream ? 'border-[#c9a45a]/50' : 'border-[#d9b87c]/25',
        'last:border-r-0 disabled:cursor-default',
        wide && 'col-span-2 sm:col-span-3',
        !disabled && 'active:scale-[0.98] active:bg-white/[0.06]',
        won && 'bg-[#e8c06a]/20',
        yours > 0 && 'ring-1 ring-[#e8c06a]/60 ring-inset',
      )}
    >
      <span className={cn('text-[0.62rem] leading-tight font-bold', cream ? 'text-[#1b4d39]' : 'text-white/85')}>
        {name}
      </span>

      {/* The payout. An em dash when the server has not quoted one — never a
          zero, which on a betting board reads as "this pays nothing". */}
      <span
        className={cn(
          'text-[1.05rem] leading-none font-black tabular-nums',
          cream ? 'text-[#1b4d39]' : 'text-[#ffd97a]',
        )}
      >
        {multiplier === null ? '—' : `${multiplier}x`}
      </span>

      {/* Real money on the market, in place of the reference's capacity dots. */}
      <span
        className={cn(
          'flex items-center gap-1 text-[0.52rem] leading-none',
          cream ? 'text-[#1b4d39]/55' : 'text-white/45',
        )}
      >
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
