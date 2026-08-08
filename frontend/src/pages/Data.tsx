import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip as ChartTooltip,
  type Plugin,
  type ScriptableContext,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useStats, useHistory, useVip } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { moneyFromDecimal } from '@/lib/money';
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
              value={moneyFromDecimal(stats.data.netProfit, { sign: true })}
              tone={Number(stats.data.netProfit) >= 0 ? 'success' : 'danger'}
            />
            {/* VPIP and PFR are not here on purpose. They need preflop ACTION
                data — did the player voluntarily put money in, did they raise —
                and the ledger records only a round's net movement. The mockup
                shows 23.1% and 38.7%; those are design-document numbers, and
                printing them next to real figures makes all six look real. */}
            <Tile label={t('account.statBiggestWin')} value={moneyFromDecimal(stats.data.biggestWin)} tone="accent" />
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
        {moneyFromDecimal(round.net, { sign: true })}
      </div>
    </li>
  );
}

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, ChartTooltip);

/** Dashed vertical guide through the hovered point, drawn behind the tooltip. */
const crosshairPlugin: Plugin<'line'> = {
  id: 'trendCrosshair',
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements();
    if (!active || active.length === 0) return;
    const { top, bottom } = chart.chartArea;
    const { ctx } = chart;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(148, 148, 180, 0.35)';
    ctx.beginPath();
    ctx.moveTo(active[0].element.x, top);
    ctx.lineTo(active[0].element.x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

/**
 * Cumulative profit across the loaded rounds.
 *
 * History arrives newest-first, so it is reversed to run left-to-right in time.
 * The line is the running total, not per-round values — a player wants to see
 * whether they are up, not the shape of individual hands. Profit is a polarity,
 * so the encoding follows the sign everywhere: the line and its fill are green
 * above zero and red below, switching exactly at the baseline rather than
 * painting the whole series by the final value.
 */
function TrendChart({ rounds }: { rounds: HistoryEntry[] }) {
  const ordered = [...rounds].reverse();

  // Burst data lands on one day, where repeating the same date says nothing —
  // label by time within a day, by date across days.
  const sameDay = new Set(ordered.map((r) => new Date(r.at).toDateString())).size <= 1;
  const formatLabel = (ts: number | string) => {
    const d = new Date(ts);
    if (sameDay) {
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    }
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
  };

  const labels: string[] = [];
  const values: number[] = [];
  let running = 0;
  for (const r of ordered) {
    running += Number(r.net) || 0;
    labels.push(formatLabel(r.at));
    values.push(running);
  }

  const lastIndex = values.length - 1;

  // Chart.js paints to canvas, which can't resolve CSS variables — read the
  // theme's concrete values off :root instead of hardcoding a second palette.
  const rootStyle = getComputedStyle(document.documentElement);
  const gain = rootStyle.getPropertyValue('--success').trim() || '#3fd07a';
  const loss = rootStyle.getPropertyValue('--danger').trim() || '#f85677';
  const surface = rootStyle.getPropertyValue('--surface').trim() || '#17172b';
  const tick = { color: 'rgba(148, 148, 180, 0.8)', font: { size: 10 } };
  const endColor = (values[lastIndex] ?? 0) >= 0 ? gain : loss;

  const signedMoney = (v: number) =>
    (v >= 0 ? '+' : '') + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /** 0..1 position of the zero line inside the plot, for gradient stops. */
  const zeroStop = (chart: ChartJS): number | null => {
    const { chartArea, scales } = chart;
    if (!chartArea || !scales.y) return null;
    const zero = scales.y.getPixelForValue(0);
    return Math.min(1, Math.max(0, (zero - chartArea.top) / (chartArea.bottom - chartArea.top)));
  };

  const lineGradient = ({ chart }: ScriptableContext<'line'>) => {
    const t = zeroStop(chart);
    if (t === null) return gain;
    const { chartArea, ctx } = chart;
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, gain);
    g.addColorStop(t, gain);
    g.addColorStop(Math.min(1, t + 0.0001), loss);
    g.addColorStop(1, loss);
    return g;
  };

  const fillGradient = ({ chart }: ScriptableContext<'line'>) => {
    const t = zeroStop(chart);
    if (t === null) return 'transparent';
    const { chartArea, ctx } = chart;
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, `${gain}59`);
    g.addColorStop(t, `${gain}00`);
    g.addColorStop(Math.min(1, t + 0.0001), `${loss}00`);
    g.addColorStop(1, `${loss}59`);
    return g;
  };

  // The endpoint is the number the card is about — give it a dot and a label.
  const endpointLabel: Plugin<'line'> = {
    id: 'trendEndpointLabel',
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(0);
      const point = meta?.data?.[lastIndex];
      if (!point) return;
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillStyle = endColor;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      const y = Math.max(chartArea.top + 12, point.y - 10);
      ctx.fillText(signedMoney(values[lastIndex] ?? 0), point.x - 6, y);
      ctx.restore();
    },
  };

  return (
    <div className="h-40 w-full">
      <Line
        data={{
          labels,
          datasets: [
            {
              data: values,
              borderColor: lineGradient,
              borderWidth: 2,
              // Monotone keeps the curve smooth without overshooting past the
              // real cumulative values at the turns.
              cubicInterpolationMode: 'monotone',
              fill: 'origin',
              backgroundColor: fillGradient,
              pointRadius: values.map((_, i) => (i === lastIndex ? 4 : 0)),
              pointHoverRadius: 5,
              pointBackgroundColor: endColor,
              pointBorderColor: surface,
              pointBorderWidth: 2,
              pointHoverBackgroundColor: ({ parsed }: ScriptableContext<'line'>) =>
                (parsed?.y ?? 0) >= 0 ? gain : loss,
              pointHoverBorderColor: surface,
              pointHoverBorderWidth: 2,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          layout: { padding: { top: 12, right: 8 } },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: { ...tick, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 },
            },
            y: {
              // The zero baseline is the reading anchor — keep it visible while
              // the other gridlines stay recessive.
              grid: {
                color: (ctx) => (ctx.tick.value === 0 ? 'rgba(148, 148, 180, 0.45)' : 'rgba(148, 148, 180, 0.1)'),
              },
              border: { display: false },
              ticks: {
                ...tick,
                maxTicksLimit: 5,
                callback: (v) => (Math.abs(Number(v)) >= 1000 ? `${Number(v) / 1000}K` : `${v}`),
              },
            },
          },
          plugins: {
            tooltip: {
              displayColors: false,
              backgroundColor: '#20203a',
              titleColor: 'rgba(255, 255, 255, 0.55)',
              titleFont: { size: 10, weight: 'normal' },
              bodyFont: { size: 12, weight: 'bold' },
              padding: { x: 10, y: 6 },
              cornerRadius: 10,
              caretSize: 4,
              callbacks: {
                label: (ctx) => signedMoney(ctx.parsed.y ?? 0),
                labelTextColor: (ctx) => ((ctx.parsed.y ?? 0) >= 0 ? gain : loss),
              },
            },
          },
        }}
        plugins={[crosshairPlugin, endpointLabel]}
      />
    </div>
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
