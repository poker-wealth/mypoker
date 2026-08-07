import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Spade, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useFirstRun } from '@/store/firstRun';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';

/**
 * First-open welcome.
 *
 * Shown once, then never again. Three cards, all skippable from the first —
 * someone who wants to play should never have to read their way into a poker
 * app, and a welcome that cannot be dismissed is an obstacle rather than a
 * greeting.
 *
 * It waits for the language picker. Rendering a welcome in a language the player
 * has not chosen yet would undo the point of asking.
 *
 * The middle card leads with provable fairness because that is the actual claim
 * this product makes, and the last card ends on a table rather than a deposit:
 * asking a stranger for money before they have seen a hand is how a poker app
 * loses them.
 */

const SLIDES: { key: string; icon: LucideIcon; tone: string }[] = [
  { key: 'welcome', icon: Spade, tone: 'text-brand' },
  { key: 'fair', icon: ShieldCheck, tone: 'text-success' },
  { key: 'play', icon: Wallet, tone: 'text-accent' },
];

export function Onboarding() {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);

  const languageChosen = useFirstRun((s) => s.languageChosen);
  const onboarded = useFirstRun((s) => s.onboarded);
  const markOnboarded = useFirstRun((s) => s.markOnboarded);

  if (onboarded || !languageChosen) return null;

  const slide = SLIDES[index]!;
  const last = index === SLIDES.length - 1;
  const Icon = slide.icon;

  // No navigation on purpose. This renders outside the router — useNavigate
  // would throw there — and it does not need to: a first launch already lands on
  // the lobby, so dismissing IS arriving at the table list.
  const finish = (): void => {
    haptic('light');
    markOnboarded();
  };

  return (
    <AnimatePresence>
      <motion.div
        // Below the language picker (z-200), above everything else.
        className="fixed inset-0 z-[190] flex flex-col bg-bg px-6 pb-8 pt-14"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        role="dialog"
        aria-modal="true"
      >
        <button
          onClick={() => finish()}
          className="self-end text-xs font-semibold text-dim"
        >
          {t('onboarding.skip')}
        </button>

        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <motion.div
            key={slide.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex flex-col items-center"
          >
            <div className={cn('mb-6 grid size-20 place-items-center rounded-3xl bg-surface', slide.tone)}>
              <Icon size={36} />
            </div>
            <h1 className="text-xl font-black">{t(`onboarding.${slide.key}.title`)}</h1>
            <p className="mt-2 max-w-[19rem] text-sm leading-relaxed text-dim">
              {t(`onboarding.${slide.key}.body`)}
            </p>
          </motion.div>
        </div>

        <div className="mb-5 flex justify-center gap-1.5">
          {SLIDES.map((s, i) => (
            <span
              key={s.key}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === index ? 'w-5 bg-brand' : 'w-1.5 bg-border',
              )}
            />
          ))}
        </div>

        <Button
          full
          onClick={() => {
            haptic('light');
            if (last) finish();
            else setIndex((i) => i + 1);
          }}
        >
          {last ? t('onboarding.start') : t('onboarding.next')}
        </Button>
      </motion.div>
    </AnimatePresence>
  );
}
