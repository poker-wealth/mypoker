import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Segmented } from '@/components/ui/Segmented';

/**
 * Tab 4 — Data: play statistics and records.
 *
 * Presentational for now — there's no stats endpoint yet, so the figures below are
 * sample data and labelled as such rather than passed off as real. The charts are
 * hand-rolled inline SVG on purpose: two small shapes don't justify pulling in a
 * charting dependency.
 */

type Period = 'today' | '7d' | '30d' | 'all';

const PERIODS: { value: Period; key: string }[] = [
  { value: 'today', key: 'data.periodToday' },
  { value: '7d', key: 'data.period7d' },
  { value: '30d', key: 'data.period30d' },
  { value: 'all', key: 'data.periodAll' },
];

const OVERVIEW = [
  { key: 'data.hands', value: '1,234' },
  { key: 'data.winRate', value: '52.3%' },
  { key: 'data.netProfit', value: '+₮1,234', tone: 'success' as const },
  { key: 'data.vpip', value: '23.1%' },
  { key: 'data.pfr', value: '38.7%' },
  { key: 'data.largestPot', value: '₮2,356', tone: 'accent' as const },
];

const TREND = [-180, 120, 60, 340, 280, 520, 610, 900, 1050, 1234];

const DISTRIBUTION = [
  { key: 'gameNames.texas', pct: 65, color: 'var(--brand)' },
  { key: 'gameNames.niuniu', pct: 20, color: 'var(--accent)' },
  { key: 'gameNames.baccarat', pct: 10, color: 'var(--success)' },
  { key: 'data.others', pct: 5, color: 'var(--text-dim)' },
];

export function Data() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>('today');

  return (
    <div className="space-y-4">
      <Segmented
        options={PERIODS.map((p) => ({ value: p.value, label: t(p.key) }))}
        value={period}
        onChange={setPeriod}
      />

      {/* Overview tiles */}
      <section>
        <h2 className="mb-2.5 text-sm font-bold">{t('data.overview')}</h2>
        <div className="grid grid-cols-3 gap-3">
          {OVERVIEW.map((s) => (
            <div
              key={s.key}
              className="rounded-(--radius-app) border border-border bg-surface px-2 py-3 text-center"
            >
              <div
                className={
                  'text-base font-black tabular-nums ' +
                  (s.tone === 'success'
                    ? 'text-success'
                    : s.tone === 'accent'
                      ? 'text-accent'
                      : '')
                }
              >
                {s.value}
              </div>
              <div className="mt-0.5 text-[0.66rem] text-dim">{t(s.key)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Profit trend */}
      <section className="rounded-(--radius-app) border border-border bg-surface p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-bold">{t('data.profitTrend')}</h2>
          <span className="text-xs font-semibold text-success tabular-nums">+₮1,234.56</span>
        </div>
        <TrendChart values={TREND} />
      </section>

      {/* Play distribution */}
      <section className="rounded-(--radius-app) border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-bold">{t('data.playDistribution')}</h2>
        <div className="flex items-center gap-5">
          <DonutChart segments={DISTRIBUTION} />
          <ul className="min-w-0 flex-1 space-y-2">
            {DISTRIBUTION.map((d) => (
              <li key={d.key} className="flex items-center gap-2 text-xs">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: d.color }}
                />
                <span className="min-w-0 flex-1 truncate text-dim">{t(d.key)}</span>
                <span className="font-semibold tabular-nums">{d.pct}%</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="pt-1 text-center text-[0.66rem] text-dim">
        {t('data.pendingEndpoints')}
      </div>
    </div>
  );
}

/** Sparkline-style profit curve with a soft gradient fill under it. */
function TrendChart({ values }: { values: number[] }) {
  const W = 100;
  const H = 40;
  const PAD = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const pt = (v: number, i: number): [number, number] => [
    (i / (values.length - 1)) * W,
    H - PAD - ((v - min) / span) * (H - PAD * 2),
  ];

  const points = values.map(pt);
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const last = points[points.length - 1]!;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--success)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--success)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#trend-fill)" />
      <path
        d={line}
        fill="none"
        stroke="var(--success)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="1.8" fill="var(--success)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Donut built from a single circle per segment. The radius is 50/π so the
 * circumference is exactly 100 — dash lengths are then percentages directly.
 */
function DonutChart({ segments }: { segments: { key: string; pct: number; color: string }[] }) {
  const R = 50 / Math.PI;
  let offset = 25; // rotate the start to 12 o'clock

  return (
    <svg viewBox="0 0 40 40" className="size-28 shrink-0">
      <circle cx="20" cy="20" r={R} fill="none" stroke="var(--border)" strokeWidth="6" />
      {segments.map((s) => {
        const dash = `${s.pct} ${100 - s.pct}`;
        const el = (
          <circle
            key={s.key}
            cx="20"
            cy="20"
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth="6"
            strokeDasharray={dash}
            strokeDashoffset={offset}
            transform="rotate(-90 20 20)"
          />
        );
        offset -= s.pct;
        return el;
      })}
    </svg>
  );
}
