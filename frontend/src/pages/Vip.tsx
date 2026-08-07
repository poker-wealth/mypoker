import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Crown, Lock, Check } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { useVip } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { useSession } from '@/store/session';
import { cn } from '@/lib/cn';
import type { VipTier } from '@/api/vip';

/**
 * VIP — tier, progress, and what each tier is worth.
 *
 * Progress is measured between the current threshold and the next, not from
 * zero: a V4 who is most of the way to V5 should not see 25%.
 *
 * The figure shown is EFFECTIVE volume, which is what the ladder actually grades
 * on — Texas counts in full, Baccarat at ×0.3. Showing raw volume next to a
 * threshold the raw figure will never meet is the kind of near-miss that reads
 * as the platform moving the goalposts.
 */

const TIER_ORDER: VipTier[] = ['V1', 'V2', 'V3', 'V4', 'V5'];

const TIER_STYLE: Record<VipTier, string> = {
  V1: 'text-dim',
  V2: 'text-info',
  V3: 'text-jackpot',
  V4: 'text-brand',
  V5: 'text-accent',
};

const usd = (micros: number): string =>
  (micros / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 });

export function Vip() {
  const { t } = useTranslation();
  const signedIn = useSession((s) => s.status === 'authenticated');
  const vip = useVip();

  if (!signedIn) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <EmptyState icon={Crown} title={t('vip.signInToSee')} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {vip.isPending && (
        <>
          <div className="rounded-(--radius-app) border border-border bg-surface p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-8 w-32" />
            <Skeleton className="mt-4 h-2 w-full" />
          </div>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-(--radius-app)" />
          ))}
        </>
      )}

      {vip.isError && (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <ErrorState message={t(errorKey(vip.error))} onRetry={() => void vip.refetch()} />
        </div>
      )}

      {vip.isSuccess && (
        <>
          {/* Current standing */}
          <div className="rounded-(--radius-app) border border-border bg-surface p-5">
            <div className="flex items-center gap-2">
              <Crown size={18} className={TIER_STYLE[vip.data.tier]} />
              <span className={cn('text-lg font-black', TIER_STYLE[vip.data.tier])}>
                {vip.data.tier}
              </span>
              <span className="text-sm font-semibold text-dim">
                {t(`vip.title.${vip.data.tier}`)}
              </span>
            </div>

            <div className="mt-3 text-[0.66rem] uppercase tracking-wide text-dim">
              {t('vip.effectiveVolume')}
            </div>
            <div className="text-2xl font-black tabular-nums">
              ₮{usd(vip.data.cumulativeEffective)}
            </div>

            {vip.data.next ? (
              <>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundImage: 'var(--brand-gradient)' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${vip.data.progressPct}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-[0.66rem] text-dim">
                  <span>{vip.data.progressPct}%</span>
                  <span className="tabular-nums">
                    {t('vip.remaining', {
                      amount: usd(vip.data.next.remaining),
                      tier: vip.data.next.tier,
                    })}
                  </span>
                </div>
              </>
            ) : (
              <div className="mt-3 text-xs font-semibold text-accent">{t('vip.topTier')}</div>
            )}
          </div>

          {/* Where the volume came from — and why it may be less than staked */}
          {vip.data.breakdown.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">
                {t('vip.byGame')}
              </h2>
              <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
                {vip.data.breakdown.map((g) => (
                  <li key={g.gameId} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {t(`gameNames.${g.gameId}`, { defaultValue: g.gameId })}
                      </div>
                      <div className="truncate text-[0.66rem] text-dim tabular-nums">
                        {t('vip.roundsStaked', { rounds: g.rounds, staked: usd(g.staked) })}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-bold tabular-nums">₮{usd(g.effective)}</div>
                      <div className="text-[0.6rem] text-dim">{t('vip.counted')}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 px-1 text-[0.66rem] leading-relaxed text-dim">
                {t('vip.coefficientNote')}
              </p>
            </section>
          )}

          {/* The ladder */}
          <section>
            <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">
              {t('vip.tiers')}
            </h2>
            <ul className="space-y-2">
              {TIER_ORDER.map((tier) => {
                const reached = TIER_ORDER.indexOf(vip.data.tier) >= TIER_ORDER.indexOf(tier);
                return (
                  <li
                    key={tier}
                    className={cn(
                      'rounded-(--radius-app) border p-4',
                      reached ? 'border-border bg-surface' : 'border-border/50 bg-surface/40',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {reached ? (
                        <Check size={14} className="shrink-0 text-success" />
                      ) : (
                        <Lock size={14} className="shrink-0 text-dim" />
                      )}
                      <span className={cn('font-black', reached ? TIER_STYLE[tier] : 'text-dim')}>
                        {tier}
                      </span>
                      <span className={cn('text-sm font-semibold', reached ? '' : 'text-dim')}>
                        {t(`vip.title.${tier}`)}
                      </span>
                    </div>
                    <p className={cn('mt-1.5 text-[0.7rem] leading-relaxed', reached ? 'text-dim' : 'text-dim/70')}>
                      {t(`vip.perks.${tier}`)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
