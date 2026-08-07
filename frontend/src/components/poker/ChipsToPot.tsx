import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { SeatPos } from '@/lib/tableDesigns';

/**
 * Chips flying from each seat into the pot at the end of a betting street.
 *
 * The moment this exists for: when a street ends, every bet in front of a seat
 * is swept into the middle. Without the sweep the numbers simply change — bets
 * vanish, the pot jumps — and a player who looked away has no idea whose money
 * moved or how much. The flight IS the explanation.
 *
 * Purely decorative and purely derived: it renders from the same view-model
 * everything else does, holds no authority over any number, and unmounting it
 * mid-flight loses nothing. The pot total is already correct before the first
 * chip lands.
 *
 * Fires on a STREET change rather than on bets going to zero, because those are
 * different events — bets also clear when a hand ends with everyone folding,
 * and sweeping chips into a pot nobody contested would be a lie about the hand.
 */

export interface FlyingBet {
  seatIndex: number;
  amount: number;
  from: SeatPos;
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export function ChipsToPot({
  street,
  bets,
}: {
  /** Changing this is what triggers a sweep. */
  street: string;
  /** Everyone with chips in front of them, and where they sit. */
  bets: FlyingBet[];
}) {
  const [flying, setFlying] = useState<FlyingBet[]>([]);
  const previousStreet = useRef(street);
  // Read at mount: a player who has asked for less motion gets the numbers
  // without the theatre, and the pot is authoritative either way.
  const [reduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (street === previousStreet.current) return;
    previousStreet.current = street;
    if (reduced) return;

    // Snapshot the bets AS THEY WERE when the street turned. Reading them later
    // would find zeros — the server has already swept them — and animate
    // nothing at all.
    const swept = bets.filter((b) => b.amount > 0);
    if (swept.length === 0) return;

    setFlying(swept);
    const id = setTimeout(() => setFlying([]), 620);
    return () => clearTimeout(id);
    // Deliberately keyed on `street` alone: re-running when `bets` changes would
    // restart the flight on every chip movement within a street.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [street, reduced]);

  return (
    <AnimatePresence>
      {flying.map((bet) => (
        <motion.div
          key={`${bet.seatIndex}-${bet.amount}`}
          className="pointer-events-none absolute z-20"
          style={{ left: bet.from.left, top: bet.from.top }}
          initial={{ x: '-50%', y: '-50%', opacity: 1, scale: 1 }}
          // The pot sits at the centre of the felt, so every chip converges on
          // 50%/44% regardless of which seat it left.
          animate={{
            left: '50%',
            top: '44%',
            opacity: [1, 1, 0],
            scale: [1, 1, 0.7],
          }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
        >
          <div className="flex items-center gap-1 rounded-full bg-surface/95 px-2 py-0.5 text-[0.6rem] font-bold tabular-nums shadow-lg ring-1 ring-border">
            <span className="size-2 rounded-full bg-jackpot" />
            {bet.amount.toLocaleString()}
          </div>
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
