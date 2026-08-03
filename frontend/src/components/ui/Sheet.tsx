import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

/** A bottom sheet — the standard mobile drawer for tables, filters, confirmations. */
export function Sheet({ open, onClose, title, children, className }: SheetProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/55"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className={cn(
              'fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85vh] max-w-[520px] overflow-y-auto',
              'rounded-t-2xl border-t border-border bg-bg pb-6',
              className,
            )}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 340 }}
          >
            <div className="mx-auto mt-2.5 mb-1 h-1 w-10 rounded-full bg-border" />
            {title && (
              <div className="border-b border-border px-4 py-3 text-center font-semibold">{title}</div>
            )}
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
