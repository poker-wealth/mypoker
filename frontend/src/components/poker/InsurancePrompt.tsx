import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { haptic } from '@/lib/telegram';

/**
 * The all-in insurance prompt.
 *
 * Takes a quote and nothing else. There is deliberately no snapshot, no
 * exposure, no risk multiplier in these props — the spec says the UI shows
 * "final odds number ONLY. No RiskFactor. No calculation details", and the
 * cheapest way to honour that is a component that never receives them. It
 * cannot leak what it was never given.
 *
 * Rendering is the caller's decision, not this component's. The spec's skip
 * rule for three or more all-in players is "silently skips" — so the prompt must
 * not mount at all in that case, rather than mounting and declining. A prompt
 * that appears and then refuses still tells the table something happened.
 *
 * The timer matters as much as the odds. An insurance decision sits between a
 * player and a hand they are already all-in on, so it takes the decision away
 * on expiry rather than blocking the table indefinitely.
 */

/**
 * Exactly the shape game-server/src/games/texas/underwriting.ts already emits.
 *
 * Mirrored rather than redefined: that module is the one the engine calls, and a
 * second definition of "what a quote is" would drift into showing a number the
 * server never sent.
 */
export interface InsuranceQuote {
  /** What the player pays, micro-USD. */
  premium: number;
  /** What they receive if the hand goes against them, micro-USD. */
  coverage: number;
  /** coverage / premium — e.g. 20 means "pay 5 to receive 100". The only
   *  derived figure the UI shows, and the only one it is given. */
  payoutOdds: number;
}

const usd = (micros: number): string =>
  (micros / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export function InsurancePrompt({
  quote,
  seconds = 10,
  onAccept,
  onDecline,
}: {
  /** Null when no insurance is offered — the prompt simply does not appear. */
  quote: InsuranceQuote | null;
  seconds?: number;
  onAccept: (quote: InsuranceQuote) => void;
  onDecline: () => void;
}) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (!quote) return;
    setRemaining(seconds);
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          // Expiry declines. Doing nothing is the safe default: it costs the
          // player a premium they did not choose to pay, and leaves the hand
          // exactly as it stood.
          onDecline();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, seconds]);

  return (
    <AnimatePresence>
      {quote && (
        <motion.div
          className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[520px] p-4"
          initial={{ y: 120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 120, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        >
          <div className="rounded-(--radius-app) border border-accent/40 bg-surface p-4 shadow-lg">
            <div className="flex items-center gap-2">
              <ShieldCheck size={17} className="shrink-0 text-accent" />
              <span className="text-sm font-bold">{t('insurance.title')}</span>
              <span className="ml-auto text-xs tabular-nums text-dim">{remaining}s</span>
            </div>

            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <div className="text-[0.62rem] uppercase tracking-wide text-dim">
                  {t('insurance.odds')}
                </div>
                <div className="text-2xl font-black tabular-nums text-accent">
                  {quote.payoutOdds.toFixed(2)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[0.62rem] uppercase tracking-wide text-dim">
                  {t('insurance.payout')}
                </div>
                <div className="text-lg font-bold tabular-nums">₮{usd(quote.coverage)}</div>
              </div>
            </div>

            <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
              <motion.div
                className="h-full rounded-full bg-accent"
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: seconds, ease: 'linear' }}
              />
            </div>

            <div className="mt-3 flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => {
                  haptic('light');
                  onDecline();
                }}
              >
                {t('insurance.decline')}
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  haptic('medium');
                  onAccept(quote);
                }}
              >
                {t('insurance.accept', { premium: usd(quote.premium) })}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
