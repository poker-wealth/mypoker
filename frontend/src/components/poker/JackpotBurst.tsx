import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Trophy } from 'lucide-react';
import { haptic } from '@/lib/telegram';
import { chips } from '@/lib/money';
import type { JackpotTier } from '@/api/jackpot';

/**
 * The jackpot win celebration.
 *
 * Duration comes from the server's own per-tier `animationMs` (Mini 3s → Grand
 * 10s) rather than a constant here, so a Grand hit is visibly a bigger event
 * than a Mini one and the two never disagree about how long that is.
 *
 * Dismissible from the first frame. A ten-second animation nobody can skip is a
 * ten-second animation in the way of the next hand, and the player who just won
 * is the one most likely to want to get on with it.
 *
 * Honours prefers-reduced-motion: the burst becomes a plain card. Someone who
 * has asked their device for less movement has not asked for less information.
 */

const TIER_STYLE: Record<JackpotTier, { ring: string; text: string; particles: number }> = {
  MINI: { ring: 'border-info', text: 'text-info', particles: 10 },
  MINOR: { ring: 'border-accent', text: 'text-accent', particles: 16 },
  MAJOR: { ring: 'border-brand', text: 'text-brand', particles: 24 },
  GRAND: { ring: 'border-jackpot', text: 'text-jackpot', particles: 40 },
};

export interface JackpotWin {
  tier: JackpotTier;
  /** Table currency (chips). */
  amount: number;
  /** How long the server says this tier's celebration runs. */
  animationMs: number;
  /** Distinguishes consecutive wins so the same hit isn't replayed. */
  roundId: string;
}


const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export function JackpotBurst({ win, onDone }: { win: JackpotWin | null; onDone: () => void }) {
  const { t } = useTranslation();
  const [reduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (!win) return;
    // A Grand hit should be felt, not just seen.
    haptic(win.tier === 'GRAND' || win.tier === 'MAJOR' ? 'heavy' : 'medium');
    const id = setTimeout(onDone, win.animationMs);
    return () => clearTimeout(id);
  }, [win, onDone]);

  const style = win ? (TIER_STYLE[win.tier] ?? TIER_STYLE.MINI) : TIER_STYLE.MINI;

  return (
    <AnimatePresence>
      {win && (
        <motion.div
          className="fixed inset-0 z-[180] grid place-items-center bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onDone}
          role="dialog"
          aria-modal="true"
        >
          {/* Particles are decoration only — everything they convey is also in
              the text beneath, so dropping them for reduced motion loses
              nothing. */}
          {!reduced &&
            Array.from({ length: style.particles }).map((_, i) => (
              <motion.span
                key={i}
                className="pointer-events-none absolute size-1.5 rounded-full bg-jackpot"
                initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                animate={{
                  opacity: 0,
                  x: Math.cos((i / style.particles) * Math.PI * 2) * 190,
                  y: Math.sin((i / style.particles) * Math.PI * 2) * 190,
                  scale: 0.2,
                }}
                transition={{ duration: 1.4, ease: 'easeOut', delay: (i % 5) * 0.06 }}
              />
            ))}

          <motion.div
            className={`relative mx-6 rounded-3xl border-2 ${style.ring} bg-surface px-8 py-7 text-center`}
            initial={reduced ? { opacity: 0 } : { scale: 0.5, opacity: 0, rotate: -6 }}
            animate={reduced ? { opacity: 1 } : { scale: 1, opacity: 1, rotate: 0 }}
            transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 260, damping: 18 }}
          >
            <motion.div
              animate={reduced ? {} : { rotate: [0, -8, 8, 0] }}
              transition={{ duration: 0.9, repeat: Infinity, repeatDelay: 0.5 }}
            >
              <Trophy size={52} className={`mx-auto ${style.text}`} />
            </motion.div>

            <div className={`mt-3 text-xs font-black uppercase tracking-[0.2em] ${style.text}`}>
              {t(`jackpot.tier.${win.tier}`)}
            </div>
            <div className="mt-1 text-4xl font-black tabular-nums">{chips(win.amount)}</div>
            <div className="mt-2 text-xs text-dim">{t('jackpot.youWon')}</div>
            <div className="mt-4 text-[0.62rem] text-dim">{t('jackpot.tapToDismiss')}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
