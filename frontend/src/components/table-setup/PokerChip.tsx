import { cn } from '@/lib/cn';

/**
 * A poker chip, drawn in CSS — the thumb of every slider and toggle on the
 * create-a-game screen, exactly as in the reference app.
 *
 * Pure artwork: edge stripes from a repeating conic gradient, a pale face, a
 * hollow-looking centre. Colours come off the token block (`--chip`,
 * `--surface`), never hex, so a rebrand restyles the chips with everything
 * else. `muted` is the greyed chip an OFF toggle shows.
 */
export function PokerChip({
  size = 26,
  muted = false,
  className,
}: {
  size?: number;
  muted?: boolean;
  className?: string;
}) {
  const stripe = muted ? 'var(--text-dim)' : 'var(--chip)';
  return (
    <span
      aria-hidden
      className={cn('relative inline-block shrink-0 rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: `repeating-conic-gradient(${stripe} 0deg 24deg, #f5f2ea 24deg 60deg)`,
        boxShadow: '0 1px 3px rgb(0 0 0 / 0.45)',
        opacity: muted ? 0.55 : 1,
      }}
    >
      {/* The face: a paler disc floating on the striped edge. */}
      <span
        className="absolute rounded-full"
        style={{
          inset: '18%',
          background: '#f5f2ea',
          border: `1.5px solid ${stripe}`,
        }}
      />
      {/* The "hollow" centre the reference chips show. */}
      <span
        className="absolute rounded-full"
        style={{ inset: '38%', background: 'var(--surface-2)' }}
      />
    </span>
  );
}
