import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface FullScreenModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * A modal that takes the whole viewport, rather than sharing it.
 *
 * `Sheet` caps itself at 85vh and leaves the page visible behind it, which is
 * right for a confirmation and wrong for a deposit address. That screen asks
 * someone to read three things carefully and at the same time — the address,
 * the chain it must be sent on, and the warning about sending anything else —
 * and a cramped drawer competing with the page underneath is how USDT ends up
 * on the wrong network, which is unrecoverable.
 *
 * It still slides up from the bottom, because that is the gesture a Mini App
 * user expects, but it lands on the full screen with its own header. Safe-area
 * insets are honoured on both edges: in a Telegram WebView the top inset sits
 * under the system bar and the bottom under the home indicator, and without
 * them the close button is behind the status bar on a notched phone.
 *
 * Sits above `Sheet` (z-40/50, elevated 60/70) and `Modal` (60) so it covers an
 * open sheet completely rather than appearing to hover inside one.
 */
export function FullScreenModal({
  open,
  onClose,
  title,
  children,
  className,
}: FullScreenModalProps) {
  // Escape closes it. Bound only while open, torn down on close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          className={cn('fixed inset-0 z-[80] flex flex-col bg-bg', className)}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 32, stiffness: 340 }}
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2.5">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-9 shrink-0 place-items-center rounded-lg text-dim transition-colors hover:bg-surface-2 hover:text-text"
            >
              <X size={18} />
            </button>
            {/* Padded on the right by the button's width so the title is centred
                against the screen, not against the space left over beside it. */}
            <h2 className="min-w-0 flex-1 truncate pr-9 text-center font-semibold">{title}</h2>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
