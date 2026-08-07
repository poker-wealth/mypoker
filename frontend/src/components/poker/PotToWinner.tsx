import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { chips } from '@/lib/money';
import type { SeatPos } from '@/lib/tableDesigns';

/**
 * The pot travelling from the middle to whoever won it.
 *
 * The counterpart to ChipsToPot, and the moment a hand actually resolves. A
 * stack that simply increments tells a player they won; watching the pot arrive
 * tells them how much and from where — and at a table with side pots, WHICH pot
 * came to them. Poker's whole emotional payload is in this half-second.
 *
 * Decorative and derived, like the sweep: the ledger settled before any of this
 * rendered. If the component never mounts, the chips are still exactly right.
 *
 * Deliberately silent when there is no showdown — a hand everyone folds out of
 * has a winner but no drama worth staging, and animating it every time would
 * make the celebration mean nothing when it matters.
 */

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export function PotToWinner({
  handId,
  amount,
  winners,
}: {
  /** Changing this is what arms the next celebration. */
  handId: string | number | null;
  /** The pot as it stood before it was awarded. */
  amount: number;
  /** Where each winning seat sits. Split pots animate to each of them. */
  winners: SeatPos[];
}) {
  const [showing, setShowing] = useState<SeatPos[]>([]);
  const lastHand = useRef(handId);
  const [reduced] = useState(prefersReducedMotion);

  useEffect(() => {
    // Arm on the hand ENDING, not on a winner appearing: `isWinner` can flicker
    // true mid-hand on some feeds, and a celebration that fires early spoils
    // the showdown it is meant to punctuate.
    if (handId === lastHand.current) return;
    lastHand.current = handId;
    if (reduced || winners.length === 0 || amount <= 0) return;

    setShowing(winners);
    const id = setTimeout(() => setShowing([]), 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handId, reduced]);

  // Split pots divide the visible amount so the numbers add up to the pot —
  // showing each winner the full pot would misreport what they received.
  const share = showing.length > 0 ? Math.floor(amount / showing.length) : 0;

  return (
    <AnimatePresence>
      {showing.map((seat, i) => (
        <motion.div
          key={`${seat.left}-${seat.top}-${i}`}
          className="pointer-events-none absolute z-30"
          initial={{ left: '50%', top: '44%', x: '-50%', y: '-50%', opacity: 0, scale: 0.6 }}
          animate={{
            left: seat.left,
            top: seat.top,
            opacity: [0, 1, 1, 0],
            scale: [0.6, 1.15, 1, 0.9],
          }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1], times: [0, 0.25, 0.7, 1] }}
        >
          <div className="rounded-full bg-success px-2.5 py-1 text-[0.66rem] font-black tabular-nums text-white shadow-lg">
            +{chips(share)}
          </div>
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
