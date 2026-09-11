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
import { previousWindow } from '@/api/stats';
import { errorKey } from '@/api/errors';
import { moneyFromDecimal } from '@/lib/money';
import { cn } from '@/lib/cn';
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
  const [tab, setTab] = useState<'overview' | 'hands'>('overview');
  /**
   * One specific day, or '' for the rolling period.
   *
   * A REAL filter, not a label: the server reports on that calendar day alone
   * (UTC) and ignores `period` while it is set. Picking a date therefore has to
   * visibly clear the period buttons, or the screen would show "Today"
   * highlighted above figures from three weeks ago.
   */
  const [day, setDay] = useState('');
  const signedIn = useSession((s) => s.status === 'authenticated');

  const stats = useStats(period, day || undefined);
  // The window just gone, for the deltas. Skipped entirely when a specific day
  // is selected: a single date is not a rolling window and has no 'previous'.
  const prevWindow = day === '' ? previousWindow(period) : null;
  const prevStats = useStats(period, undefined, prevWindow ?? undefined);
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
      <div className="flex items-center gap-2">
        <div className={cn('min-w-0 flex-1', day !== '' && 'opacity-40')}>
          <Segmented
            options={PERIODS.map((p) => ({ value: p.value, label: t(p.key) }))}
            value={period}
            onChange={(next) => {
              // Choosing a period abandons the specific day. The two answer the
              // same question differently and only one can be live.
              setDay('');
              setPeriod(next);
            }}
          />
        </div>

        {/* A native date input, deliberately: every phone already knows how to
            present one, in the player's own locale and calendar, and a
            hand-rolled calendar in eight languages is a lot of surface to get
            subtly wrong. `max` is today — there are no figures for tomorrow. */}
        <input
          type="date"
          value={day}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setDay(e.target.value)}
          aria-label={t('data.pickDay')}
          className="shrink-0 rounded-(--radius-app) border border-border bg-surface px-2 py-1.5 text-[0.7rem] text-text [color-scheme:dark]"
        />
      </div>

      {/* The escape hatch. Without it a player who picks a date can only get
          back to a rolling window by guessing that tapping a period does it. */}
      {day !== '' && (
        <button
          type="button"
          onClick={() => setDay('')}
          className="text-[0.68rem] font-semibold text-brand underline underline-offset-2"
        >
          {t('data.clearDay')}
        </button>
      )}

      {/*
        TWO TABS, not the reference's four.

        The reference has Overview / Hands / Tables / Analysis. Only the first
        two have anything to show. "Tables" would list the tables a player has
        sat at, which is not recorded — the ledger stores a round's net movement
        and no table identity. "Analysis" is the radar and its six stats, which
        need preflop action data that is not recorded either.

        Drawing four tabs where two open an empty screen is the same mistake as
        a greyed control with no reason: it reads as a feature that exists and
        is merely quiet. Two honest tabs beat four with nothing behind them, and
        the other two arrive on their own when hand histories do.
      */}
      <Segmented
        options={[
          { value: 'overview' as const, label: t('data.tabOverview') },
          { value: 'hands' as const, label: t('data.tabHands') },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <>
      {/* THE HEADLINE FIGURE.
          Net profit was one tile among six, the same size as "Hands" — so the
          one number a player opens this tab to see had no more weight than a
          count. The reference leads with it at display size, and it is the
          right call: everything else on the page is context for this line.

          Still the same value as the tile it replaces, from the same field. */}
      {/* TWO COLUMNS, as the reference has it: the headline figure beside the
          curve rather than stacked above it. Stacking put the chart a full
          screen below the number it describes. Single column on a narrow phone,
          where two would leave both too cramped to read. */}
      {stats.isSuccess && (
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-(--radius-app) border border-border bg-surface p-4">
            <h2 className="text-[0.7rem] font-bold uppercase tracking-wider text-dim">
              {t('data.totalProfit')}
            </h2>
            <p
              className={cn(
                'mt-1 text-3xl font-black tabular-nums leading-none',
                Number(stats.data.netProfit) >= 0 ? 'text-success' : 'text-danger',
              )}
            >
              {moneyFromDecimal(stats.data.netProfit, { sign: true })}
            </p>
            <p className="mt-1.5 text-[0.68rem] text-dim">
              {day !== '' ? day : t(PERIODS.find((p) => p.value === period)?.key ?? 'data.periodAll')}
            </p>
          </div>

          {/* The curve, in the second column. Needs two points to be a line —
              with fewer, the panel says the period is empty rather than drawing
              a flat line that looks like a real result of zero. */}
          <div className="rounded-(--radius-app) border border-border bg-surface p-4">
            <h2 className="mb-2 text-[0.7rem] font-bold uppercase tracking-wider text-dim">
              {t('data.profitTrend')}
            </h2>
            {/* The curve is drawn from the ROUND LIST, which is still fetched
                by period — `/me/history` does not take a day yet. So while a
                specific day is selected the two would describe different
                windows: the headline saying one date, the chart beside it
                showing thirty. It says so instead of drawing the mismatch.
                Remove this branch once history accepts `day` too. */}
            {day !== '' ? (
              <p className="py-6 text-center text-[0.7rem] text-dim">{t('data.dayChartSoon')}</p>
            ) : rounds.length > 1 ? (
              <TrendChart rounds={rounds} />
            ) : (
              <p className="py-6 text-center text-[0.7rem] text-dim">{t('data.noRounds')}</p>
            )}
          </div>
        </section>
      )}

      {/* Overview */}
      <section>
        <h2 className="mb-2.5 text-sm font-bold">{t('data.overview')}</h2>

        {/* Four skeletons, matching the four real tiles below — six placeholders
            for four figures made the page reflow as it loaded. */}
        {stats.isPending && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
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

        {/* Four across, as the reference's stat strip is — the four figures read
            as one row of headline numbers rather than a 3+1 grid with an orphan
            on the second line. Two across on a narrow phone. */}
        {stats.isSuccess && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Tile
              label={t('data.hands')}
              value={String(stats.data.handsPlayed)}
              delta={
                <Delta
                  current={stats.data.handsPlayed}
                  previous={prevStats.data?.handsPlayed ?? 0}
                  // `hadPrior` is about whether a comparison EXISTS, not whether
                  // it is non-zero: a loaded prior window of zero hands is still
                  // "no basis to compare", handled inside Delta.
                  hadPrior={prevWindow !== null && prevStats.isSuccess}
                />
              }
            />
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

      {/* Time of day — real, and computed the same way the trend is: from the
          rounds actually loaded, so it can never disagree with the list below.
          Each round carries its own timestamp, which is the whole of what this
          needs. Nothing here is estimated. */}
      <TimeOfDay rounds={rounds} />

      {/* Play distribution — real, from the VIP volume tracker, which records
          per-game rounds at settlement. The mockup's fixed 65/20/10/5 split is
          replaced rather than kept: a pie chart of invented percentages is a
          claim about how this player spends their time. */}
      <PlayDistribution />

        </>
      )}

      {tab === 'hands' && (
        <>
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
                  {history.isFetchingNextPage ? t('common.loading') : t('data.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
        </>
      )}
    </div>
  );
}

/**
 * Change against the equivalent window just gone — "+18.6%" under Today means
 * today measured against yesterday.
 *
 * THE THREE CASES THAT MUST NOT BECOME A GREEN ARROW:
 *
 *  1. NO PRIOR WINDOW. 'all' has no "before", and a specific day is not a
 *     rolling window either. Renders nothing at all.
 *  2. THE PRIOR WINDOW IS EMPTY. No hands last week is not "0" last week —
 *     there is nothing to compare against, so there is no percentage. A dash.
 *  3. THE PRIOR VALUE IS ZERO. Percent change from zero is undefined: $0 → $50
 *     is neither "+100%" nor "+∞%". Both are inventions. Shows the direction
 *     without a figure.
 *
 * The reference prints a green arrow and a number on every tile. With a fresh
 * account every one of them would be fabricated.
 */
function Delta({ current, previous, hadPrior }: { current: number; previous: number; hadPrior: boolean }) {
  const { t } = useTranslation();
  if (!hadPrior) return <span className="text-[0.6rem] text-dim">—</span>;

  if (previous === 0) {
    if (current === 0) return <span className="text-[0.6rem] text-dim">—</span>;
    return (
      <span className={cn('text-[0.6rem] font-bold', current > 0 ? 'text-success' : 'text-danger')}>
        {current > 0 ? '▲' : '▼'} {t('data.deltaNew')}
      </span>
    );
  }

  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(pct)) return <span className="text-[0.6rem] text-dim">—</span>;

  return (
    <span className={cn('text-[0.6rem] font-bold tabular-nums', pct >= 0 ? 'text-success' : 'text-danger')}>
      {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function Tile({
  label,
  value,
  tone,
  delta,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger' | 'accent';
  /** Change against the window just gone. Omitted where there is no comparison. */
  delta?: React.ReactNode;
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
      <div className="mt-0.5 flex items-center justify-between gap-1">
        <span className="min-w-0 truncate text-[0.66rem] text-dim">{label}</span>
        {delta}
      </div>
    </div>
  );
}

/**
 * Profit split across four six-hour bands.
 *
 * REAL, unlike most of what the reference design puts on this screen: every
 * round carries its own timestamp, so bucketing them needs no data the ledger
 * does not have. Contrast VPIP/PFR/position/hand-type, which are absent from
 * this page because they would have to be invented.
 *
 * UTC, matching `periodStart` on the server, which defines "today" in UTC for
 * the same reason: there is no reliable timezone for a player, and a boundary
 * that shifts per request is worse than one that is consistently explainable.
 * Said on screen rather than left for someone to discover.
 *
 * Computed from the LOADED rounds, like the trend chart above — so as more
 * pages load, both refine together and neither can contradict the list.
 */
function TimeOfDay({ rounds }: { rounds: HistoryEntry[] }) {
  const { t } = useTranslation();
  if (rounds.length === 0) return null;

  const BANDS = ['00:00 – 06:00', '06:00 – 12:00', '12:00 – 18:00', '18:00 – 24:00'];
  const net = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];

  for (const round of rounds) {
    const at = new Date(round.at);
    const hour = at.getUTCHours();
    if (Number.isNaN(hour)) continue; // a malformed timestamp is skipped, not bucketed as midnight
    const band = Math.min(3, Math.floor(hour / 6));
    net[band] += Number(round.net);
    counts[band] += 1;
  }

  // The widest bar is the scale. Absolute, so a losing band is drawn as long
  // as a winning band of the same size — the colour says which it is.
  const peak = Math.max(...net.map(Math.abs), 1);
  // Only meaningful among bands that were actually played.
  const played = net.map((v, i) => ({ v, i })).filter(({ i }) => counts[i]! > 0);
  const best = played.length > 0 ? played.reduce((a, b) => (b.v > a.v ? b : a)) : null;

  return (
    <section className="rounded-(--radius-app) border border-border bg-surface p-4">
      <h2 className="text-[0.7rem] font-bold uppercase tracking-wider text-dim">
        {t('data.timeOfDay')}
      </h2>

      <div className="mt-3 space-y-2">
        {BANDS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-[0.66rem] tabular-nums text-dim">{label}</span>
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
              <span
                className={cn(
                  'block h-full rounded-full',
                  net[i]! >= 0 ? 'bg-success' : 'bg-danger',
                )}
                style={{ width: `${counts[i]! === 0 ? 0 : (Math.abs(net[i]!) / peak) * 100}%` }}
              />
            </span>
            <span
              className={cn(
                'w-16 shrink-0 text-right text-[0.66rem] font-bold tabular-nums',
                // A band with no rounds shows a dash, NOT "+0.00" — nothing
                // played is not the same claim as played and broke even.
                counts[i]! === 0 ? 'text-dim' : net[i]! >= 0 ? 'text-success' : 'text-danger',
              )}
            >
              {counts[i]! === 0 ? '—' : moneyFromDecimal(String(net[i]), { sign: true })}
            </span>
          </div>
        ))}
      </div>

      {best !== null && (
        <p className="mt-3 text-[0.66rem] text-dim">
          {t('data.bestPeriod')}: <span className="font-bold text-text">{BANDS[best.i]}</span>
        </p>
      )}
      <p className="mt-1 text-[0.62rem] text-dim/70">{t('data.timeOfDayUtc')}</p>
    </section>
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
