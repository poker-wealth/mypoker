import { motion } from 'motion/react';
import { rankOf, suitOf, isRedSuit, type Card } from '@/lib/cards';
import { useTablePrefs } from '@/store/tablePrefs';
import { cn } from '@/lib/cn';

type Size = 'sm' | 'md' | 'lg';

const sizes: Record<Size, string> = {
  sm: 'h-11 w-8 text-[0.7rem] rounded-md',
  md: 'h-16 w-11 text-sm rounded-lg',
  lg: 'h-20 w-14 text-base rounded-lg',
};

interface PlayingCardProps {
  /** engine string like 'As'; omit / null → renders face-down */
  card?: Card | null;
  faceDown?: boolean;
  size?: Size;
  className?: string;
  /** stagger index for the deal animation */
  index?: number;
}

/** A single playing card. Flips/deals in with a spring; face-down shows the brand back. */
export function PlayingCard({ card, faceDown, size = 'md', className, index = 0 }: PlayingCardProps) {
  const down = faceDown || !card;
  const red = card ? isRedSuit(card) : false;
  const suit = card ? suitOf(card) : '';
  /**
   * Four-colour deck: diamonds blue, clubs green, hearts and spades unchanged.
   * The point is telling the two reds and the two blacks apart at a glance.
   *
   * This preference was being SAVED and never read — the setting moved and the
   * cards did not. Read from the store here rather than threaded down as a
   * prop: every card on every felt needs it, and a prop would have to cross
   * seats, the board, the rankings chart and the demo table to arrive.
   */
  const fourColour = useTablePrefs((s) => s.fourColour);

  return (
    <motion.div
      initial={{ opacity: 0, y: -14, rotateZ: -8, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, rotateZ: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30, delay: index * 0.06 }}
      className={cn(
        'relative grid shrink-0 select-none place-items-center shadow-md',
        sizes[size],
        down ? 'border border-brand/40' : 'border border-black/10 bg-white',
        className,
      )}
      style={
        down
          ? { backgroundImage: 'var(--brand-gradient)' }
          : undefined
      }
    >
      {down ? (
        <span className="text-lg font-black text-white/85">♠</span>
      ) : (
        <div
          className={cn(
            'flex h-full w-full flex-col justify-between p-1',
            fourColour
              ? suit === '♦'
                ? 'text-[#2563eb]'
                : suit === '♣'
                  ? 'text-[#15803d]'
                  : red
                    ? 'text-[#e11d48]'
                    : 'text-[#0d0d1a]'
              : red
                ? 'text-[#e11d48]'
                : 'text-[#0d0d1a]',
          )}
        >
          <span className="text-left font-bold leading-none">{rankOf(card!)}</span>
          <span className="text-center text-[1.4em] leading-none">{suitOf(card!)}</span>
          <span className="rotate-180 text-left font-bold leading-none">{rankOf(card!)}</span>
        </div>
      )}
    </motion.div>
  );
}
