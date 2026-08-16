import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAdminAlerts } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { cn } from '@/lib/cn';
import type { AdminAlert, BreakerStatus } from '@/api/admin';

/**
 * Admin — Alerts.
 *
 * The seven breakers' current state, then the security log newest first
 * (SAMUEL.md task 3, screen 5).
 *
 * Polled every 5 seconds, which is not a guess: the spec budgets that exact
 * window — "trigger CB6 (non-whitelist flow attempt) → alert appears in admin
 * panel within 5 seconds". It is the one screen where staleness is the failure.
 *
 * Read-only, and the log is append-only behind it. An alert cannot be
 * acknowledged or dismissed from here, because a security trail someone can
 * tidy is not a trail.
 */
export function AdminAlerts() {
  const { t } = useTranslation();
  const alerts = useAdminAlerts();

  if (alerts.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full rounded-(--radius-app)" />
        <Skeleton className="h-32 w-full rounded-(--radius-app)" />
      </div>
    );
  }

  if (alerts.isError) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <ErrorState message={t(errorKey(alerts.error))} onRetry={() => void alerts.refetch()} />
      </div>
    );
  }

  const { events, breakers } = alerts.data;
  const critical = events.filter((e) => e.severity === 'CRITICAL').length;

  return (
    <div className="space-y-6">
      {critical > 0 && (
        <div className="rounded-(--radius-app) border border-danger/40 bg-danger/10 px-4 py-3">
          <div className="text-sm font-bold text-danger">
            {critical} critical {critical === 1 ? 'alert' : 'alerts'} in the recent log
          </div>
          <div className="mt-0.5 text-[0.66rem] leading-relaxed text-dim">
            A rejected fund flow means something attempted a movement the clearing rules forbid.
            The transfer did not happen — the alert is that it was tried.
          </div>
        </div>
      )}

      <section>
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">
          Circuit breakers
        </h2>
        <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
          {breakers.map((b) => (
            <BreakerRow key={b.id} breaker={b} />
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">
          Security log
        </h2>

        {events.length === 0 ? (
          <div className="rounded-(--radius-app) border border-border bg-surface">
            <EmptyState
              icon={ShieldCheck}
              title="Nothing logged"
              description="Rejected fund flows, tripped breakers and bad-contract deposits appear here as they happen."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
            {events.map((e) => (
              <AlertRow key={e.id} alert={e} />
            ))}
          </ul>
        )}
      </section>

      <p className="px-1 text-[0.62rem] leading-relaxed text-dim">
        Append-only. Alerts cannot be dismissed or edited from here — a trail that can be tidied
        is not a trail. Refreshes every 5 seconds.
      </p>
    </div>
  );
}

const TONE: Record<string, { badge: 'warn' | 'neutral' | 'success'; text: string }> = {
  CRITICAL: { badge: 'warn', text: 'text-danger' },
  WARN: { badge: 'warn', text: 'text-jackpot' },
  INFO: { badge: 'neutral', text: 'text-dim' },
};

function AlertRow({ alert }: { alert: AdminAlert }) {
  const tone = TONE[alert.severity] ?? TONE.INFO!;
  // The detail is whatever the writer recorded — account ids, amounts, a
  // rejected path. Rendered as-is rather than interpreted: an alert's value is
  // that it says exactly what happened.
  const detail = Object.entries(alert.detail)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn('truncate text-xs font-semibold', tone.text)}>{alert.label}</span>
        <Badge tone={tone.badge}>{alert.severity.toLowerCase()}</Badge>
      </div>
      {detail && (
        <div className="mt-1 break-all font-mono text-[0.6rem] leading-relaxed text-dim">
          {detail}
        </div>
      )}
      <div className="mt-0.5 text-[0.6rem] text-dim">{new Date(alert.at).toLocaleString()}</div>
    </li>
  );
}

function BreakerRow({ breaker }: { breaker: BreakerStatus }) {
  const notRunning = breaker.status === 'planned';
  const tripped = breaker.tripsToday > 0;

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="shrink-0 font-mono text-[0.62rem] text-dim">{breaker.id}</span>
      <span className="min-w-0 flex-1 truncate text-xs">{breaker.name}</span>
      {tripped && (
        <span className="shrink-0 text-[0.62rem] tabular-nums text-dim">
          {breaker.tripsToday}× today
        </span>
      )}
      <Badge tone={notRunning ? 'neutral' : tripped ? 'warn' : 'success'}>
        {notRunning ? 'not running' : tripped ? 'tripped' : 'armed'}
      </Badge>
    </li>
  );
}
