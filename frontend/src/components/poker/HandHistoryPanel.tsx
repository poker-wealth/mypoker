import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Star, Share2, User } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The hand-history panel, opened from the table's list icon.
 *
 * WHAT IS REAL: the table's name, its blinds, how many are seated, its id, and
 * Share — all off the snapshot, all live.
 *
 * WHAT IS DRAWN BUT DISABLED, each for its own reason:
 *
 *  - THE HAND SCRUBBER browses past hands. No hand histories are recorded
 *    anywhere in this platform, so there is nothing to scrub through; `0/0` is
 *    the literal truth rather than a placeholder. This is the same wall the
 *    Data page radar and the profile stat row are behind — one backend feature
 *    unlocks all three.
 *  - ANONYMOUS SEATING has no backend at all. Nothing in the room, the gateway
 *    or the seat record supports hiding who is sitting.
 *  - FAVOURITE TABLES likewise: no favourites exist, so `0/15` counts nothing.
 *
 * Drawn rather than omitted because the layout is the owner's, who asked for
 * "the ui, no need for connection". Disabled WITH its reason rather than greyed
 * in silence, because a control that looks live and does nothing is the failure
 * this project keeps correcting.
 */
export function HandHistoryPanel({
  open,
  onClose,
  name,
  tableId,
  smallBlind,
  bigBlind,
  seated,
  onShare,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  tableId: string;
  smallBlind: number;
  bigBlind: number;
  /** How many are sitting. Real, from the snapshot. */
  seated: number;
  onShare: () => void;
}) {
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/50"
          />
          {/* From the right, like the reference — and the table stays visible
              down the left edge so you can still see the hand. */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            role="dialog"
            aria-label={t('table.handHistory')}
            className="fixed inset-y-0 right-0 z-[61] flex w-[min(78vw,20rem)] flex-col bg-[#141013]/97 shadow-2xl backdrop-blur-md"
          >
            {/* Header — every figure here is real. */}
            <div className="flex items-start justify-between gap-3 px-4 pt-5">
              <div className="min-w-0">
                <p className="truncate text-[0.86rem] font-bold text-coin-gold">{name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[0.72rem] text-dim">
                  <span className="tabular-nums">
                    {smallBlind}/{bigBlind}
                  </span>
                  <User size={11} />
                  <span className="tabular-nums">{seated}</span>
                </p>
              </div>
              <p className="shrink-0 font-mono text-[0.72rem] text-coin-gold">#{tableId}</p>
            </div>

            {/* Anonymous — disabled, with why. */}
            <div className="mt-3 flex items-center justify-between gap-3 px-4">
              <span className="text-[0.74rem] text-dim">{t('table.anonymous')}</span>
              <span
                role="switch"
                aria-checked={false}
                aria-disabled
                title={t('table.anonymousSoon')}
                className="relative h-6 w-11 shrink-0 cursor-not-allowed rounded-full border border-border bg-surface-2 opacity-60"
              >
                <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white/70" />
              </span>
            </div>
            <p className="px-4 pt-1 text-[0.55rem] text-dim/70">{t('table.anonymousSoon')}</p>

            {/* The hands themselves. Empty, and saying so plainly. */}
            <div className="flex flex-1 items-center justify-center px-6 text-center">
              <p className="text-[0.72rem] leading-relaxed text-dim">
                {t('table.noHandHistory')}
              </p>
            </div>

            {/* The scrubber. Inert — there is nothing to scrub. */}
            <div className="flex items-center gap-3 border-t border-border/60 px-4 py-3">
              <button
                type="button"
                disabled
                aria-label={t('table.previousHand')}
                className="shrink-0 cursor-not-allowed text-dim opacity-50"
              >
                <ChevronLeft size={17} />
              </button>

              <div className="min-w-0 flex-1">
                <div className="relative h-1 rounded-full bg-surface-2">
                  <span className="absolute right-0 top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-coin-gold/70" />
                </div>
                <p className="mt-1 text-center text-[0.62rem] tabular-nums text-dim">0/0</p>
              </div>

              <button
                type="button"
                disabled
                aria-label={t('table.nextHand')}
                className="shrink-0 cursor-not-allowed text-dim opacity-50"
              >
                <ChevronRight size={17} />
              </button>

              {/* Favourites — no backend, so the count is literally zero. */}
              <button
                type="button"
                disabled
                title={t('table.favouritesSoon')}
                aria-label={t('table.favourite')}
                className="flex shrink-0 cursor-not-allowed flex-col items-center text-coin-gold opacity-60"
              >
                <Star size={16} />
                <span className="text-[0.55rem] tabular-nums">0/15</span>
              </button>

              {/* Share IS wired — the same invite link the menu copies. */}
              <button
                type="button"
                onClick={onShare}
                aria-label={t('table.menuShare')}
                className={cn('shrink-0 text-dim transition-colors active:text-text')}
              >
                <Share2 size={16} />
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
