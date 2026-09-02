import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { chips } from '@/lib/money';
import { play } from '@/lib/sound';
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
  youWon,
}: {
  /** Changing this is what arms the next celebration. */
  handId: string | number | null;
  /** The pot as it stood before it was awarded. */
  amount: number;
  /** Where each winning seat sits. Split pots animate to each of them. */
  winners: SeatPos[];
  /**
   * Whether the player watching is one of the winners.
   *
   * The chips fly for everybody — that is how the table reads who took the pot.
   * The chime does not: a win sound on a hand you just lost is the app cheering
   * at you.
   */
  youWon: boolean;
}) {
  const [showing, setShowing] = useState<SeatPos[]>([]);
  /** The hand we have already celebrated. One celebration per hand, ever. */
  const celebrated = useRef<string | number | null>(null);
  const [reduced] = useState(prefersReducedMotion);

  useEffect(() => {
    // Arm on WINNERS APPEARING, not on handId changing.
    //
    // This used to fire when handId changed, which is the one moment the
    // winners are guaranteed to be gone. The server populates `winners` at
    // settlement and clears it in endShowdown() — both while handId stays the
    // same — so the celebration was armed on hand START (no winners yet) and on
    // hand END (already cleared), and could never once render. It was dead in
    // every live hand the table has ever played.
    //
    // `winners` non-empty IS the showdown signal: the server only fills it
    // between settlement and endShowdown. The old comment worried about
    // isWinner flickering mid-hand; the once-per-hand ref below bounds that to
    // a single early celebration rather than a loop, and no live feed produces
    // it anyway.
    if (reduced || handId === null) return;
    if (winners.length === 0 || amount <= 0) return;
    if (celebrated.current === handId) return;

    celebrated.current = handId;
    // The sound rides the same trigger as the chips, so they cannot disagree:
    // one arming, one moment. play() is silent when the player has muted — and
    // the chime is silent when they did not win, because a fanfare on a hand you
    // just lost reads as the app celebrating at you.
    if (youWon) play('win');
    setShowing(winners);
    const id = setTimeout(() => setShowing([]), 900);
    return () => clearTimeout(id);
    // winners is rebuilt every render, so it is depended on by LENGTH — the ref
    // above is what actually enforces once-per-hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handId, winners.length, amount, reduced, youWon]);

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
