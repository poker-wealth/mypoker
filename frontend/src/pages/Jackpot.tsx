import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Trophy, Lock, Clock } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useJackpot } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { cn } from '@/lib/cn';
import type { TierState } from '@/api/jackpot';

/**
 * Jackpot — four tiers, their pools, and the Grand window.
 *
 * The design question here is what a locked tier should look like. A pool below
 * its threshold cannot pay out at all, and showing it identically to an armed one
 * would imply a prize that is not actually available. So a locked tier is dimmed
 * and states what it still needs, and the Grand tier — which can only drop inside
 * a five-hour Saturday window — carries a countdown rather than a number that
 * looks claimable at any moment.
 */

const usd = (micros: number): string =>
  (micros / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const TIER_STYLE: Record<string, { ring: string; text: string }> = {
  MINI: { ring: 'border-info/40', text: 'text-info' },
  MINOR: { ring: 'border-accent/40', text: 'text-accent' },
  MAJOR: { ring: 'border-brand/40', text: 'text-brand' },
  GRAND: { ring: 'border-jackpot/50', text: 'text-jackpot' },
};

export function Jackpot() {
  const { t } = useTranslation();
  const jackpot = useJackpot();

  return (
    <div className="space-y-4">
      {jackpot.isPending && (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-(--radius-app) border border-border bg-surface p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-7 w-32" />
            </div>
          ))}
        </div>
      )}

      {jackpot.isError && (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <ErrorState message={t(errorKey(jackpot.error))} onRetry={() => void jackpot.refetch()} />
        </div>
      )}

      {jackpot.isSuccess && (
        <>
          <div className="rounded-(--radius-app) border border-jackpot/30 bg-jackpot/10 p-4 text-center">
            <div className="text-[0.66rem] font-bold uppercase tracking-widest text-jackpot/80">
              {t('jackpot.totalPools')}
            </div>
            <div className="mt-1 text-3xl font-black tabular-nums text-jackpot">
              ₮{usd(jackpot.data.total)}
            </div>
          </div>

          <GrandWindow grand={jackpot.data.grand} />

          <div className="space-y-3">
            {jackpot.data.tiers.map((tier) => (
              <TierCard key={tier.tier} tier={tier} />
            ))}
          </div>

          <p className="px-1 text-[0.66rem] leading-relaxed text-dim">{t('jackpot.howItWorks')}</p>
        </>
      )}
    </div>
  );
}

function TierCard({ tier }: { tier: TierState }) {
  const { t } = useTranslation();
  const style = TIER_STYLE[tier.tier] ?? TIER_STYLE.MAJOR!;
  const progress = Math.min(100, (tier.amount / tier.minThreshold) * 100);

  return (
    <div
      className={cn(
        'rounded-(--radius-app) border bg-surface p-4',
        tier.armed ? style.ring : 'border-border',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn('text-xs font-bold uppercase tracking-wide', tier.armed ? style.text : 'text-dim')}>
          {t(`jackpot.tier.${tier.tier}`)}
        </span>
        <span className="text-[0.62rem] text-dim">
          {t(`jackpot.cadence.${tier.cadence}`)} · {t('jackpot.paysOut', { pct: tier.payoutBps / 100 })}
        </span>
      </div>

      <div
        className={cn(
          'mt-1 text-2xl font-black tabular-nums',
          tier.armed ? style.text : 'text-dim',
        )}
      >
        ₮{usd(tier.amount)}
      </div>

      {/* A tier below its threshold cannot pay at all. Saying so is the whole
          point of the row — otherwise it reads as a prize that is available. */}
      {!tier.armed && (
        <>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-dim/40" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-1.5 flex items-center gap-1 text-[0.62rem] text-dim">
            <Lock size={11} />
            {t('jackpot.needsMore', { amount: usd(tier.minThreshold - tier.amount) })}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The Grand window, as a countdown.
 *
 * Grand can only drop inside Saturday 18:00–23:00 (UTC+8), and all three of pool
 * ≥ threshold, players seated, and inside the window must hold at once. A bare
 * number would imply it could land any time.
 */
function GrandWindow({ grand }: { grand: { open: boolean; opensAt: string; closesAt: string } }) {
  const { t } = useTranslation();
  const target = new Date(grand.open ? grand.closesAt : grand.opensAt).getTime();
  const [remaining, setRemaining] = useState(() => target - Date.now());

  useEffect(() => {
    const id = setInterval(() => setRemaining(target - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  const total = Math.max(0, remaining);
  const days = Math.floor(total / 86_400_000);
  const hours = Math.floor((total % 86_400_000) / 3_600_000);
  const mins = Math.floor((total % 3_600_000) / 60_000);
  const secs = Math.floor((total % 60_000) / 1000);

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-(--radius-app) border p-4',
        grand.open ? 'border-success/40 bg-success/10' : 'border-border bg-surface',
      )}
    >
      {grand.open ? (
        <motion.div
          animate={{ scale: [1, 1.12, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Trophy size={22} className="shrink-0 text-success" />
        </motion.div>
      ) : (
        <Clock size={22} className="shrink-0 text-dim" />
      )}
      <div className="min-w-0">
        <div className={cn('text-sm font-bold', grand.open ? 'text-success' : 'text-text')}>
          {grand.open ? t('jackpot.windowOpen') : t('jackpot.windowClosed')}
        </div>
        <div className="text-[0.66rem] tabular-nums text-dim">
          {grand.open
            ? t('jackpot.closesIn', { time: `${hours}h ${mins}m ${secs}s` })
            : t('jackpot.opensIn', { time: `${days}d ${hours}h ${mins}m` })}
        </div>
      </div>
    </div>
  );
}
