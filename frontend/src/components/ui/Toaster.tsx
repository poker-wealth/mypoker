import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToastStore, type ToastTone } from '@/store/toast';
import { haptic } from '@/lib/telegram';

/**
 * Renders the toast stack. Mounted once, at the app root.
 *
 * Sits at the TOP of the screen rather than the bottom: the bottom is occupied
 * by the tab bar on every tab screen and by the action bar at a table, and a
 * toast covering the fold/call buttons mid-hand is worse than no toast.
 */

const ICON: Record<ToastTone, LucideIcon> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const TONE: Record<ToastTone, string> = {
  success: 'border-success/35 text-success',
  error: 'border-danger/35 text-danger',
  info: 'border-accent/35 text-accent',
};

export function Toaster() {
  const { t } = useTranslation();
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      // aria-live so a screen reader announces toasts without the focus moving;
      // pointer-events-none on the container so the stack never eats taps meant
      // for the screen, re-enabled on each toast so its close button still works.
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] mx-auto flex max-w-[520px] flex-col items-center gap-2 px-4"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((item) => {
          const Icon = ICON[item.tone];
          return (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              transition={{ type: 'spring', damping: 26, stiffness: 380 }}
              className={`pointer-events-auto flex w-full items-start gap-2.5 rounded-(--radius-app) border bg-surface/95 px-3.5 py-3 shadow-[var(--shadow-pop)] backdrop-blur ${TONE[item.tone]}`}
            >
              <Icon size={18} className="mt-px shrink-0" />
              <span className="min-w-0 flex-1 text-sm font-medium text-text">{item.message}</span>
              <button
                onClick={() => {
                  haptic('light');
                  dismiss(item.id);
                }}
                className="-m-1 shrink-0 p-1 text-dim active:scale-90"
                aria-label={t('a11y.dismiss')}
              >
                <X size={15} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
