import { motion } from 'motion/react';
import { PlayingCard } from './PlayingCard';
import type { Seat } from '@/lib/table';
import { cn } from '@/lib/cn';
import { ChipStack } from './ChipStack';

/**
 * One seat on the rail: a circular avatar sitting in the table's seat marker, with the name and
 * stack on a pill beneath it, hole cards fanned behind, and the dealer button clipped to the side.
 *
 * The circle is the shape the table artwork puts at each position, so the seat reads as part of the
 * table rather than a card floating over it. Every live state has its own signal: a ring that
 * pulses and a bar that drains for the player on the clock, colour drained out of a folded seat,
 * an ALL-IN stamp, a gold winner glow, a red dot for a dropped connection.
 */

interface PlayerSeatProps {
  seat: Seat;
  align?: 'bottom' | 'top' | 'left' | 'right';
  /** Live tables: sit down in this chair. Absent on the demo table (its seats are never open). */
  onSit?: () => void;
  /** Triggered when tapping an occupied seat */
  onClick?: () => void;
  /** The current table design's accent, so open chairs and the clock read against its felt. */
  accent?: string;
}

const AVATAR = 'size-[56px] sm:size-[62px]';

export function PlayerSeat({ seat, align = 'bottom', onSit, onClick, accent = 'var(--accent)' }: PlayerSeatProps) {
  if (seat.status === 'empty') {
    // On a live table an open chair is the invitation to play — make it obviously tappable.
    if (onSit) {
      return (
        <motion.button
          whileTap={{ scale: 0.93 }}
          onClick={onSit}
          className={cn(
            AVATAR,
            'grid place-items-center rounded-full border-[1.5px] border-dashed text-[0.55rem] font-bold leading-tight tracking-wider backdrop-blur-sm transition-opacity hover:opacity-100',
            'opacity-80',
          )}
          style={{
            borderColor: accent,
            color: accent,
            background: `color-mix(in srgb, ${accent} 14%, rgba(0,0,0,0.45))`,
          }}
        >
          SIT
          <br />
          HERE
        </motion.button>
      );
    }
    return (
      <div
        className={cn(
          AVATAR,
          'grid place-items-center rounded-full border-[1.5px] border-dashed border-white/15 bg-black/30 text-[0.5rem] leading-tight tracking-wider text-white/40',
        )}
      />
    );
  }

  const folded = seat.status === 'folded';
  const toAct = seat.status === 'toact';
  // Live tables send the real deadline, so the ring drains exactly when their clock does.
  const secondsLeft = seat.deadline ? Math.max(0, (seat.deadline - Date.now()) / 1000) : 15;
  const isTop = align === 'top';

  return (
    <div
      className={cn(
        'relative flex flex-col items-center',
        folded && 'opacity-45 grayscale',
        'transition-all duration-300',
        onClick && 'cursor-pointer',
      )}
      onClick={onClick}
    >
      {/* Hole cards, fanned out behind the avatar */}
      {!folded && seat.cards.length > 0 && (
        <div
          className={cn(
            'absolute left-1/2 z-0 flex -translate-x-1/2 -space-x-4',
            isTop ? 'top-[70%]' : 'bottom-[70%]',
          )}
        >
          {seat.cards.map((c, i) => (
            <div
              key={i}
              className={cn(
                'drop-shadow-[0_6px_10px_rgba(0,0,0,0.6)]',
                i === 0 ? '-rotate-[9deg]' : 'rotate-[9deg] translate-y-0.5',
              )}
            >
              <PlayingCard card={c} faceDown={!c} size="sm" index={i} />
            </div>
          ))}
        </div>
      )}

      {/* Avatar disc */}
      <div
        className={cn(
          AVATAR,
          'relative z-10 overflow-hidden rounded-full border-2 transition-all duration-300',
          seat.isWinner && 'shadow-[0_0_22px_rgba(250,204,21,0.55)]',
          !toAct && !seat.isWinner && 'shadow-[0_4px_14px_rgba(0,0,0,0.6)]',
        )}
        style={{
          background: 'linear-gradient(180deg, #1a2444 0%, #0b1226 100%)',
          borderColor: seat.isWinner ? '#facc15' : toAct ? accent : 'rgba(255,255,255,0.18)',
          ...(toAct ? { boxShadow: `0 0 18px color-mix(in srgb, ${accent} 65%, transparent)` } : {}),
        }}
      >
        {seat.avatar ? (
          <img src={seat.avatar} alt={seat.name} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-lg font-black text-white/80">
            {seat.name.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Winner wash */}
        {seat.isWinner && <div className="absolute inset-0 bg-[#facc15]/20 mix-blend-overlay" />}

        {/* On the clock: pulsing ring + a bar that drains with their real timer */}
        {toAct && (
          <>
            <motion.div
              className="absolute inset-0 rounded-full ring-2"
              style={{ ['--tw-ring-color' as string]: accent }}
              animate={{ opacity: [0.25, 1, 0.25] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            />
            <motion.div
              key={seat.deadline ?? 'no-clock'}
              className="absolute bottom-0 left-0 h-[3px]"
              style={{ background: secondsLeft <= 5 ? 'var(--danger)' : accent }}
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: secondsLeft, ease: 'linear' }}
            />
          </>
        )}

        {/* All-in stamp */}
        {seat.status === 'allin' && (
          <div className="absolute inset-0 grid place-items-center bg-black/65 backdrop-blur-[1px]">
            <span className="-rotate-12 rounded bg-[var(--danger)] px-1 py-0.5 text-[0.5rem] font-black tracking-wide text-white">
              ALL-IN
            </span>
          </div>
        )}

        {/* At the table, not in the hand */}
        {seat.sittingOut && seat.status !== 'allin' && (
          <div className="absolute inset-0 grid place-items-center bg-black/70">
            <span className="text-[0.45rem] font-bold tracking-wide text-white/70">SITTING OUT</span>
          </div>
        )}
      </div>

      {/* Dealer button, clipped to the edge of the disc */}
      {seat.isDealer && (
        <div className="absolute -right-1.5 -top-1 z-30 grid size-5 place-items-center rounded-full bg-gradient-to-br from-white to-[#cfcfcf] text-[0.55rem] font-black text-black shadow-[0_2px_6px_rgba(0,0,0,0.7)]">
          D
        </div>
      )}

      {/* Their connection dropped — they keep the seat and the clock */}
      {seat.connected === false && (
        <div className="absolute -left-1 top-0 z-30 size-2 rounded-full bg-[var(--danger)] shadow-[0_0_6px_var(--danger)]" />
      )}

      {/* Name + stack */}
      <div className="relative z-20 -mt-2 w-[74px] rounded-full border border-white/10 bg-black/80 px-1 py-0.5 text-center backdrop-blur-sm">
        <div className="truncate text-[0.5rem] font-bold leading-tight text-white/90">{seat.name}</div>
        <div className="text-[0.6rem] font-black leading-tight tabular-nums" style={{ color: accent }}>
          ₮{seat.stack.toLocaleString()}
        </div>
      </div>

      {/* What they just did */}
      {seat.lastAction && !folded && (
        <motion.div
          key={seat.lastAction}
          initial={{ opacity: 0, y: 4, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className={cn(
            'absolute z-30 whitespace-nowrap rounded-full border border-white/15 bg-black/85 px-2 py-0.5 text-[0.5rem] font-bold text-white/90 backdrop-blur-sm',
            isTop ? 'bottom-[-16px]' : 'top-[-14px]',
          )}
        >
          {seat.lastAction}
        </motion.div>
      )}

      {/* Chips pushed toward the middle of the table */}
      {seat.bet > 0 && (
        <div
          className={cn(
            'absolute z-20 scale-[0.7] drop-shadow-xl',
            align === 'bottom' && 'top-[-34px]',
            align === 'top' && 'bottom-[-34px]',
            align === 'left' && 'right-[-42px] top-1/2 -translate-y-1/2',
            align === 'right' && 'left-[-42px] top-1/2 -translate-y-1/2',
          )}
        >
          <ChipStack amount={seat.bet} />
        </div>
      )}
    </div>
  );
}
