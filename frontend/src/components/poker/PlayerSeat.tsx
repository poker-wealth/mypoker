import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { PlayingCard } from './PlayingCard';
import type { Seat } from '@/lib/table';
import type { SeatAction } from '@/lib/liveTable';
import { cn } from '@/lib/cn';
import { chips } from '@/lib/money';
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
  const { t } = useTranslation();
  if (seat.status === 'empty') {
    // An empty chair only invites you to sit when sitting is actually on offer. Once you are
    // seated (or watching a table you cannot join) `onSit` is absent, and a ring of "+ SIT HERE"
    // buttons that do nothing is just noise on the felt. `onClick` is the challenge handler and
    // never sits anyone down, so it does not count.
    if (!onSit) {
      return (
        <div
          className={cn(AVATAR, 'rounded-full border border-dashed border-white/15 bg-black/20')}
          aria-hidden
        />
      );
    }

    return (
      <motion.button
        whileTap={{ scale: 0.93 }}
        onClick={onSit ?? onClick}
        className={cn(
          AVATAR,
          'grid place-items-center rounded-full border-[1.5px] border-dashed text-[0.6rem] font-black leading-tight tracking-wider backdrop-blur-md transition-all hover:opacity-100 shadow-md',
          'opacity-90 hover:scale-105',
        )}
        style={{
          borderColor: accent,
          color: accent,
          background: `color-mix(in srgb, ${accent} 20%, rgba(0,0,0,0.6))`,
        }}
      >
        + SIT
        <br />
        HERE
      </motion.button>
    );
  }

  const folded = seat.status === 'folded';
  const toAct = seat.status === 'toact';
  // Poker sends a structured action and the wording is chosen HERE, in the
  // player's language. The other game rooms still send a rendered English
  // string; those are shown as-is until they get keys of their own.
  const actionLabel =
    typeof seat.lastAction === 'object'
      ? t(`table.action.${seat.lastAction.kind}`, {
          amount: chips(seat.lastAction.amount ?? 0),
        })
      : seat.lastAction;
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
      {/* Hole cards, fanned out behind the avatar.
          The fan is derived from how many cards there are, not hard-coded to two: Omaha deals four
          and they have to spread across the same seat rather than stack on top of each other. */}
      {!folded && seat.cards.length > 0 && (
        <div
          className={cn(
            'absolute left-1/2 flex -translate-x-1/2',
            seat.isHero ? 'z-30 bottom-[95%]' : 'z-0',
            seat.isHero
              ? (seat.cards.length > 2 ? '-space-x-2' : 'space-x-1')
              : (seat.cards.length > 2 ? '-space-x-5' : '-space-x-4'),
            !seat.isHero && (isTop ? 'top-[70%]' : 'bottom-[70%]'),
          )}
        >
          {seat.cards.map((c, i) => {
            // −1 … 1 across the fan: the outer cards tilt away and sit a touch lower, the way a
            // held hand curves. A single card stays upright.
            const spread = seat.cards.length > 1 ? (i / (seat.cards.length - 1)) * 2 - 1 : 0;
            return (
              <div
                key={i}
                className="drop-shadow-[0_6px_10px_rgba(0,0,0,0.6)]"
                style={{
                  transform: seat.isHero
                    ? `rotate(${spread * 4}deg) translateY(${Math.abs(spread) * 1}px)`
                    : `rotate(${spread * 9}deg) translateY(${Math.abs(spread) * 2}px)`,
                }}
              >
                <PlayingCard card={c} faceDown={!c} size={seat.isHero ? 'md' : 'sm'} index={i} />
              </div>
            );
          })}
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
          ${seat.stack.toLocaleString()}
        </div>
      </div>

      {/*
        What they just did.

        This was 8px (`text-[0.5rem]`) in white-on-black over a busy felt —
        present, but unreadable on a phone, so players could not tell whether
        someone had called or raised without watching the chips. It is the
        single thing other players most need to see, so it is now sized and
        COLOURED by what happened: an all-in should not look like a check.

        It pops in slightly oversized and settles, which catches the eye at the
        moment the action changes without animating on every render.
      */}
      {actionLabel && !folded && (
        <motion.div
          key={actionLabel}
          initial={{ opacity: 0, y: 4, scale: 1.25 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', damping: 18, stiffness: 420 }}
          className={cn(
            'absolute z-30 whitespace-nowrap rounded-full border px-2.5 py-1 text-[0.68rem] font-black tracking-wide shadow-lg backdrop-blur-sm',
            actionTone(seat.lastAction),
            isTop ? 'bottom-[-20px]' : 'top-[-18px]',
          )}
        >
          {actionLabel}
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

/**
 * Colour an action by what it means, so the table reads at a glance.
 *
 * Aggression is warm and loud, passivity is quiet, and folding recedes — a
 * player scanning six seats should be able to see who raised without reading a
 * word. All-in gets the danger tone because it is the one action that ends
 * somebody's tournament.
 *
 * Matched on the label's leading word. The server owns these strings
 * (`describeAction` in poker-room.ts), and an unrecognised one still renders —
 * it just falls back to the neutral tone rather than disappearing.
 */
function actionTone(action: SeatAction | string | undefined): string {
  // The structured form tells us the kind outright. The legacy string form has
  // to be sniffed from its first word — which is exactly why the structured
  // form exists.
  const word =
    typeof action === 'object'
      ? action.kind === 'allin'
        ? 'all'
        : action.kind
      : (action?.split(' ')[0]?.toLowerCase() ?? '');
  if (word === 'all' || word === 'allin') {
    return 'border-danger/40 bg-danger/85 text-white';
  }
  if (word === 'raise' || word === 'bet') return 'border-brand/40 bg-brand/85 text-white';
  if (word === 'call') return 'border-accent/40 bg-accent/85 text-black';
  if (word === 'check') return 'border-white/20 bg-black/85 text-white';
  if (word === 'fold') return 'border-white/10 bg-black/70 text-white/55';
  return 'border-white/15 bg-black/85 text-white';
}
