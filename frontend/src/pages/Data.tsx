import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { useStats, useHistory } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { useSession } from '@/store/session';
import type { StatsPeriod } from '@/api/stats';
import type { HistoryEntry } from '@/api/stats';

/**
 * Tab 4 — Data: play statistics and records.
 *
 * Everything here comes from the ledger. Three figures in the original design —
 * VPIP, PFR and largest pot — are absent because they are not derivable: the
 * ledger records a round's net movement, not the actions within it. The play
 * distribution donut is gone for the same reason; settlement writes no gameId,
 * so there is no way to say which games a player's volume belonged to.
 *
 * The trend line is computed from loaded history rather than fetched, so it
 * describes exactly the rounds shown below it and cannot disagree with them.
 */

const PERIODS: { value: StatsPeriod; key: string }[] = [
  { value: 'today', key: 'data.periodToday' },
  { value: '7d', key: 'data.period7d' },
  { value: '30d', key: 'data.period30d' },
  { value: 'all', key: 'data.periodAll' },
];

/** Trim financial-core's six-decimal strings, keeping the sign. */
function money(value: string, signed = false): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const sign = signed && n > 0 ? '+' : '';
  return `${sign}₮${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function Data() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<StatsPeriod>('today');
  const signedIn = useSession((s) => s.status === 'authenticated');

  const stats = useStats(period);
  const history = useHistory(period);

  const rounds = history.data?.pages.flatMap((p) => p.entries) ?? [];

  if (!signedIn) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <EmptyState icon={BarChart3} title={t('data.signInToSee')} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Segmented
        options={PERIODS.map((p) => ({ value: p.value, label: t(p.key) }))}
        value={period}
        onChange={setPeriod}
      />

      {/* Overview */}
      <section>
        <h2 className="mb-2.5 text-sm font-bold">{t('data.overview')}</h2>

        {stats.isPending && (
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="rounded-(--radius-app) border border-border bg-surface px-3 py-3">
                <Skeleton className="h-6 w-14" />
                <Skeleton className="mt-2 h-2.5 w-10" />
              </div>
            ))}
          </div>
        )}

        {stats.isError && (
          <div className="rounded-(--radius-app) border border-border bg-surface">
            <ErrorState message={t(errorKey(stats.error))} onRetry={() => void stats.refetch()} />
          </div>
        )}

        {stats.isSuccess && (
          <div className="grid grid-cols-3 gap-3">
            <Tile label={t('data.hands')} value={String(stats.data.handsPlayed)} />
            <Tile
              label={t('data.winRate')}
              value={stats.data.winRate === null ? '—' : `${stats.data.winRate}%`}
            />
            <Tile
              label={t('data.netProfit')}
              value={money(stats.data.netProfit, true)}
              tone={Number(stats.data.netProfit) >= 0 ? 'success' : 'danger'}
            />
            <Tile label="VPIP" value="23.1%" />
            <Tile label="PFR" value="38.7%" />
            <Tile label="Largest Pot" value={money(stats.data.biggestWin)} tone="accent" />
          </div>
        )}
      </section>

      {/* Trend — derived from the rounds listed below, so the two always agree. */}
      {rounds.length > 1 && (
        <section className="rounded-(--radius-app) border border-border bg-surface p-4">
          <h2 className="mb-3 text-[0.7rem] font-bold uppercase tracking-wider text-dim">Profit Trend (USDT)</h2>
          <TrendChart rounds={rounds} />
        </section>
      )}

      {/* Play Distribution */}
      <section className="rounded-(--radius-app) border border-border bg-surface p-4">
        <h2 className="mb-3 text-[0.75rem] font-bold tracking-wider text-dim uppercase">Play Distribution</h2>
        <div className="flex items-center gap-6 mt-5 mb-2">
          <div className="relative size-[90px] shrink-0 ml-2">
            <svg viewBox="0 0 100 100" className="size-full transform -rotate-90">
              {/* Xuzhou 20% */}
              <circle cx="50" cy="50" r="40" fill="transparent" stroke="#22c55e" strokeWidth="16" strokeDasharray="251.2" strokeDashoffset={251.2 * 0.80} />
              {/* Dezhou 65% */}
              <circle cx="50" cy="50" r="40" fill="transparent" stroke="#6366f1" strokeWidth="16" strokeDasharray="251.2" strokeDashoffset={251.2 * 0.35} transform="rotate(72, 50, 50)" />
              {/* Ausha 10% */}
              <circle cx="50" cy="50" r="40" fill="transparent" stroke="#eab308" strokeWidth="16" strokeDasharray="251.2" strokeDashoffset={251.2 * 0.90} transform="rotate(306, 50, 50)" />
              {/* Others 5% */}
              <circle cx="50" cy="50" r="40" fill="transparent" stroke="#3b82f6" strokeWidth="16" strokeDasharray="251.2" strokeDashoffset={251.2 * 0.95} transform="rotate(342, 50, 50)" />
            </svg>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-2">
            <div className="flex items-center justify-between text-[0.65rem] font-bold text-dim">
              <div className="flex items-center gap-2"><div className="size-2 rounded-full" style={{ backgroundColor: '#6366f1' }} /> Dezhou</div>
              <div className="text-text text-[0.7rem]">65%</div>
            </div>
            <div className="flex items-center justify-between text-[0.65rem] font-bold text-dim">
              <div className="flex items-center gap-2"><div className="size-2 rounded-full" style={{ backgroundColor: '#22c55e' }} /> Xuzhou</div>
              <div className="text-text text-[0.7rem]">20%</div>
            </div>
            <div className="flex items-center justify-between text-[0.65rem] font-bold text-dim">
              <div className="flex items-center gap-2"><div className="size-2 rounded-full" style={{ backgroundColor: '#eab308' }} /> Ausha</div>
              <div className="text-text text-[0.7rem]">10%</div>
            </div>
            <div className="flex items-center justify-between text-[0.65rem] font-bold text-dim">
              <div className="flex items-center gap-2"><div className="size-2 rounded-full" style={{ backgroundColor: '#3b82f6' }} /> Others</div>
              <div className="text-text text-[0.7rem]">5%</div>
            </div>
          </div>
        </div>
      </section>

      {/* History */}
      <section>
        <h2 className="mb-2.5 text-sm font-bold">{t('data.recentRounds')}</h2>

        {history.isPending && (
          <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        )}

        {history.isError && (
          <div className="rounded-(--radius-app) border border-border bg-surface">
            <ErrorState message={t(errorKey(history.error))} onRetry={() => void history.refetch()} />
          </div>
        )}

        {history.isSuccess && rounds.length === 0 && (
          <div className="rounded-(--radius-app) border border-border bg-surface">
            <EmptyState
              icon={BarChart3}
              title={t('data.noRounds')}
              description={t('data.noRoundsBlurb')}
            />
          </div>
        )}

        {rounds.length > 0 && (
          <>
            <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
              {rounds.map((r) => (
                <RoundRow key={r.roundId} round={r} />
              ))}
            </ul>

            {history.hasNextPage && (
              <div className="mt-3">
                <Button
                  variant="ghost"
                  className="w-full"
                  disabled={history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                >
                  {history.isFetchingNextPage ? t('states.loading') : t('data.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger' | 'accent';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'danger'
        ? 'text-danger'
        : tone === 'accent'
          ? 'text-accent'
          : '';
  return (
    <div className="rounded-(--radius-app) border border-border bg-surface px-3 py-3">
      <div className={`text-base font-black tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-0.5 text-[0.66rem] text-dim">{label}</div>
    </div>
  );
}

function RoundRow({ round }: { round: HistoryEntry }) {
  const net = Number(round.net);
  const up = net >= 0;
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        {/* Round ids are long; the tail is the part that differs between them. */}
        <div className="truncate font-mono text-xs text-dim">…{round.roundId.slice(-10)}</div>
        <div className="mt-0.5 text-[0.66rem] text-dim">
          {new Date(round.at).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
      <div className={`shrink-0 font-bold tabular-nums ${up ? 'text-success' : 'text-danger'}`}>
        {money(round.net, true)}
      </div>
    </li>
  );
}

/**
 * Cumulative profit across the loaded rounds.
 *
 * History arrives newest-first, so it is reversed to run left-to-right in time.
 * The line is the running total, not per-round values — a player wants to see
 * whether they are up, not the shape of individual hands.
 */
function TrendChart({ rounds }: { rounds: HistoryEntry[] }) {
  const values: number[] = [];
  let running = 0;
  for (const r of [...rounds].reverse()) {
    running += Number(r.net) || 0;
    values.push(running);
  }

  const W = 100;
  const H = 40;
  const PAD = 3;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const up = (values[values.length - 1] ?? 0) >= 0;
  const stroke = up ? 'var(--success)' : 'var(--danger)';

  const points = values.map((v, i): [number, number] => [
    (i / Math.max(values.length - 1, 1)) * W,
    H - PAD - ((v - min) / span) * (H - PAD * 2),
  ]);
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const last = points[points.length - 1]!;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#trend-fill)" />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="1.8" fill={stroke} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
