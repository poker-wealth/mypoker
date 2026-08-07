import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { useStats, useHistory, useVip } from '@/api/hooks';
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
            {/* VPIP and PFR are not here on purpose. They need preflop ACTION
                data — did the player voluntarily put money in, did they raise —
                and the ledger records only a round's net movement. The mockup
                shows 23.1% and 38.7%; those are design-document numbers, and
                printing them next to real figures makes all six look real. */}
            <Tile label={t('account.statBiggestWin')} value={money(stats.data.biggestWin)} tone="accent" />
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

      {/* Play distribution — real, from the VIP volume tracker, which records
          per-game rounds at settlement. The mockup's fixed 65/20/10/5 split is
          replaced rather than kept: a pie chart of invented percentages is a
          claim about how this player spends their time. */}
      <PlayDistribution />

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

/**
 * Where the player actually spends their time, from the VIP volume tracker.
 *
 * That tracker records rounds per game at settlement, so this is the same source
 * the VIP ladder grades on — meaning the donut and the tier can never tell
 * different stories about the same player.
 *
 * Absent entirely when there is nothing to show. An empty or single-segment
 * donut communicates less than no donut, and takes more space doing it.
 */
function PlayDistribution() {
  const { t } = useTranslation();
  const vip = useVip();

  const games = vip.data?.breakdown ?? [];
  const totalRounds = games.reduce((sum, g) => sum + g.rounds, 0);
  if (totalRounds === 0) return null;

  // Distinct hues rather than the brand ramp: adjacent segments have to be told
  // apart at 90px, which a single-hue gradient does not manage.
  const COLORS = ['#6366f1', '#22c55e', '#eab308', '#3b82f6', '#f85677', '#00d4ff'];

  // Circumference of r=40 is 251.2, so a segment's dash length is its share of
  // that. Offsets accumulate so segments sit end to end rather than overlapping.
  const CIRCUMFERENCE = 251.2;
  let offset = 0;
  const segments = games.map((g, i) => {
    const share = g.rounds / totalRounds;
    const seg = { g, share, color: COLORS[i % COLORS.length]!, offset };
    offset += share;
    return seg;
  });

  return (
    <section className="rounded-(--radius-app) border border-border bg-surface p-4">
      <h2 className="mb-3 text-[0.75rem] font-bold uppercase tracking-wider text-dim">
        {t('data.playDistribution')}
      </h2>
      <div className="mb-2 mt-5 flex items-center gap-6">
        <div className="relative ml-2 size-[90px] shrink-0">
          <svg viewBox="0 0 100 100" className="size-full -rotate-90">
            {segments.map((s) => (
              <circle
                key={s.g.gameId}
                cx="50"
                cy="50"
                r="40"
                fill="transparent"
                stroke={s.color}
                strokeWidth="16"
                strokeDasharray={`${s.share * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
                strokeDashoffset={-s.offset * CIRCUMFERENCE}
              />
            ))}
          </svg>
        </div>
        <ul className="flex flex-1 flex-col justify-center gap-2">
          {segments.map((s) => (
            <li
              key={s.g.gameId}
              className="flex items-center justify-between text-[0.65rem] font-bold text-dim"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="truncate">
                  {t(`gameNames.${s.g.gameId}`, { defaultValue: s.g.gameId })}
                </span>
              </span>
              <span className="shrink-0 text-[0.7rem] text-text tabular-nums">
                {Math.round(s.share * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
