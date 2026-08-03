import { motion } from 'motion/react';
import { PlayingCard } from './PlayingCard';
import type { Seat } from '@/lib/table';
import { cn } from '@/lib/cn';

/** One seat around the table: avatar + name/stack pill, hole cards, and a to-act ring. */
export function PlayerSeat({ seat }: { seat: Seat }) {
  if (seat.status === 'empty') {
    return (
      <div className="flex flex-col items-center gap-1 opacity-50">
        <div className="grid size-12 place-items-center rounded-full border border-dashed border-border text-[0.6rem] text-dim">
          open
        </div>
      </div>
    );
  }

  const folded = seat.status === 'folded';
  const toAct = seat.status === 'toact';

  return (
    <div className={cn('flex flex-col items-center gap-1', folded && 'opacity-40 grayscale')}>
      {/* hole cards (hero sees faces, others face-down) */}
      {!folded && (
        <div className="flex -space-x-1.5">
          {seat.cards.map((c, i) => (
            <PlayingCard key={i} card={c} faceDown={!seat.isHero && c === null ? true : !c} size="sm" index={i} />
          ))}
        </div>
      )}

      <div className="relative">
        {/* avatar */}
        <div
          className={cn(
            'grid size-12 place-items-center rounded-full text-sm font-black text-white ring-2',
            seat.isWinner ? 'ring-success' : toAct ? 'ring-accent' : 'ring-border',
          )}
          style={{
            backgroundImage: 'var(--brand-gradient)',
            boxShadow: seat.isWinner ? '0 0 18px rgb(63 208 122 / 0.7)' : undefined,
          }}
        >
          {seat.name.charAt(0).toUpperCase()}
          {seat.isDealer && (
            <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-white text-[0.6rem] font-black text-black shadow">
              D
            </span>
          )}
        </div>
        {toAct && (
          <motion.span
            className="absolute inset-0 rounded-full ring-2 ring-accent"
            animate={{ opacity: [0.2, 1, 0.2] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
        )}
      </div>

      {/* name + stack */}
      <div className="min-w-[4.5rem] rounded-full border border-border bg-surface/90 px-2 py-0.5 text-center backdrop-blur">
        <div className="truncate text-[0.66rem] font-semibold leading-tight">{seat.name}</div>
        <div className="text-[0.62rem] font-bold tabular-nums text-accent">₮{seat.stack.toLocaleString()}</div>
      </div>

      {/* committed bet chips */}
      {seat.bet > 0 && (
        <div className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[0.6rem] font-bold text-white tabular-nums">
          <span className="size-2 rounded-full" style={{ backgroundImage: 'var(--brand-gradient)' }} />
          {seat.bet.toLocaleString()}
        </div>
      )}

      {seat.status === 'allin' && (
        <span className="rounded-full bg-danger px-2 py-0.5 text-[0.55rem] font-black text-white">ALL-IN</span>
      )}
    </div>
  );
}
