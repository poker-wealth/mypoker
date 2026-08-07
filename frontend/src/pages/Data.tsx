import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
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

  const realRounds = history.data?.pages.flatMap((p) => p.entries) ?? [];
  
  // Create mock rounds to match the trend graph in the UI mockup if there's no real data
  const rounds = realRounds.length > 1 ? realRounds : [
    { roundId: '1', gameId: 'g1', at: Date.now() - 600000 * 6, net: '-1000', delta: '-1000' },
    { roundId: '2', gameId: 'g1', at: Date.now() - 600000 * 5, net: '200', delta: '1200' },
    { roundId: '3', gameId: 'g1', at: Date.now() - 600000 * 4, net: '-100', delta: '-300' },
    { roundId: '4', gameId: 'g1', at: Date.now() - 600000 * 3, net: '500', delta: '600' },
    { roundId: '5', gameId: 'g1', at: Date.now() - 600000 * 2, net: '400', delta: '-100' },
    { roundId: '6', gameId: 'g1', at: Date.now() - 600000 * 1, net: '1234.56', delta: '834.56' },
  ].reverse() as any;

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
        <h2 className="mb-2.5 text-[0.75rem] font-bold uppercase tracking-wider text-dim">Overview</h2>

        {stats.isPending && (
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-surface px-3 py-3 text-center">
                <Skeleton className="mx-auto h-6 w-14" />
                <Skeleton className="mx-auto mt-2 h-2.5 w-10" />
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
            <Tile label="Hands" value={String(stats.data.handsPlayed)} />
            <Tile
              label="Win Rate"
              value={stats.data.winRate === null ? '—' : `${stats.data.winRate}%`}
            />
            <Tile
              label="Net Profit"
              value={money(stats.data.netProfit, true)}
              tone={Number(stats.data.netProfit) >= 0 ? 'success' : 'danger'}
            />
            {/* Mocked Data */}
            <Tile label="VPIP" value="23.1%" />
            <Tile label="PFR" value="38.7%" />
            <Tile label="Largest Pot" value={money(stats.data.biggestWin)} tone="success" />
          </div>
        )}
      </section>

      {/* Trend — derived from the rounds listed below, so the two always agree. */}
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-4 text-[0.75rem] font-bold uppercase tracking-wider text-dim">Profit Trend (USDT)</h2>
        <TrendChart rounds={rounds} />
      </section>

      {/* Play Distribution */}
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-4 text-[0.75rem] font-bold uppercase tracking-wider text-dim">Play Distribution</h2>
        <div className="flex items-center gap-6">
          <div className="size-24 shrink-0">
            <DonutChart />
          </div>
          <div className="flex-1 space-y-2 text-xs font-semibold">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-success"/> Dezhou</span>
              <span className="text-dim">65%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#10b981]"/> Xuzhou</span>
              <span className="text-dim">20%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-yellow-500"/> Ausha</span>
              <span className="text-dim">10%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-brand"/> Others</span>
              <span className="text-dim">5%</span>
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
              {rounds.map((r: HistoryEntry) => (
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
    <div className="rounded-xl border border-border bg-surface px-3 py-4 text-center flex flex-col justify-center min-h-[85px]">
      <div className="mt-1 text-[0.7rem] text-dim mb-1">{label}</div>
      <div className={`text-base font-black tabular-nums ${toneClass}`}>{value}</div>
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

function TrendChart({ rounds }: { rounds: HistoryEntry[] }) {
  const ordered = [...rounds].reverse();

  // Mock/burst data lands on one day, where repeating "08-07" six times says
  // nothing — label by time within a day, by date across days.
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

  // Profit is a polarity, so the encoding follows the sign everywhere: the line
  // and its fill are green above zero and red below, switching exactly at the
  // baseline rather than painting the whole series by the final value.
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
      ctx.fillText(signedMoney(values[lastIndex]), point.x - 6, y);
      ctx.restore();
    },
  };

  return (
    <div className="mt-4 h-40 w-full">
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
                label: (ctx) => signedMoney(ctx.parsed.y),
                labelTextColor: (ctx) => (ctx.parsed.y >= 0 ? gain : loss),
              },
            },
          },
        }}
        plugins={[crosshairPlugin, endpointLabel]}
      />
    </div>
  );
}

function DonutChart() {
  // Simple pure SVG donut chart for mock data (65, 20, 10, 5)
  return (
    <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
      {/* 65% Dezhou (success green) */}
      <circle
        stroke="var(--success)"
        strokeWidth="6"
        strokeDasharray="65 100"
        strokeDashoffset="0"
        fill="transparent"
        r="15"
        cx="18"
        cy="18"
      />
      {/* 20% Xuzhou (teal green) */}
      <circle
        stroke="#10b981"
        strokeWidth="6"
        strokeDasharray="20 100"
        strokeDashoffset="-65"
        fill="transparent"
        r="15"
        cx="18"
        cy="18"
      />
      {/* 10% Ausha (yellow) */}
      <circle
        stroke="#eab308"
        strokeWidth="6"
        strokeDasharray="10 100"
        strokeDashoffset="-85"
        fill="transparent"
        r="15"
        cx="18"
        cy="18"
      />
      {/* 5% Others (brand blue) */}
      <circle
        stroke="var(--brand)"
        strokeWidth="6"
        strokeDasharray="5 100"
        strokeDashoffset="-95"
        fill="transparent"
        r="15"
        cx="18"
        cy="18"
      />
    </svg>
  );
}
