import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Badge } from '@/components/ui/Badge';
import { useOpsOverview } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { useTranslation } from 'react-i18next';
import { moneyFromDecimal } from '@/lib/money';
import type { BreakerStatus } from '@/api/admin';

/**
 * Admin — Overview.
 *
 * Read-only, and the numbers are the whole point. Two rules shape it:
 *
 * Nothing here is coloured by health. The server sends facts and no verdict,
 * because the thresholds belong to the rules that own them; a red tile decided
 * in the browser would be a second opinion that drifts from the first. The one
 * exception is a breaker that is not running, which is stated rather than
 * judged.
 *
 * No placeholder figures, ever. A dash means the server has not answered — an
 * operator reading ₮0.00 when the truth is "unknown" is how a real shortfall
 * gets missed.
 */
export function AdminOverview() {
  const { t } = useTranslation();
  const overview = useOpsOverview();

  if (overview.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-(--radius-app) border border-border bg-surface p-4">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="mt-3 h-7 w-28" />
          </div>
        ))}
      </div>
    );
  }

  if (overview.isError) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <ErrorState
          message={t(errorKey(overview.error))}
          onRetry={() => void overview.refetch()}
        />
      </div>
    );
  }

  const d = overview.data;

  return (
    <div className="space-y-6">
      {/*
        Activity first. Volume, rake and active players are what an owner opens
        this screen for; balances answer "is the money safe", which is the next
        question rather than the first.
      */}
      <section>
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">Activity</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Metric
            label="Volume"
            value={moneyFromDecimal(d.volume.allTime)}
            hint={`${moneyFromDecimal(d.volume.today)} today`}
          />
          {/*
            Rake is shown beside volume deliberately. On its own it reads as
            profit rather than as a rate on what was wagered.
          */}
          <Metric
            label="Rake"
            value={moneyFromDecimal(d.rake.allTime)}
            hint={`${moneyFromDecimal(d.rake.today)} today`}
          />
          <Metric
            label="Active players"
            value={String(d.activePlayers.today)}
            hint={`${d.activePlayers.last7Days} in 7 days`}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">Funds</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Metric
            label="Player funds"
            value={moneyFromDecimal(d.playerFunds)}
            hint="available + locked + clearing"
          />
          {d.balances
            .filter((b) => b.accountType !== 'PLAYER')
            .map((b) => (
              <Metric
                key={b.accountType}
                label={label(b.accountType)}
                value={moneyFromDecimal(b.total)}
                hint={`${b.accounts} account${b.accounts === 1 ? '' : 's'}`}
              />
            ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">
          Withdrawals
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <Metric label="Pending review" value={String(d.withdrawals.pending)} />
          <Metric
            label="Awaiting 2nd sign-off"
            value={String(d.withdrawals.awaitingSecondApproval)}
            hint="over ₮10,000"
          />
          <Metric label="In flight" value={String(d.withdrawals.inFlight)} hint="held, not yet sent" />
        </div>
      </section>

      <section>
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">
          Today (UTC)
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <Metric
            label="Deposits in"
            value={moneyFromDecimal(d.today.deposits.total)}
            hint={`${d.today.deposits.count} credited`}
          />
          <Metric
            label="Withdrawals out"
            value={moneyFromDecimal(d.today.withdrawals.total)}
            hint={`${d.today.withdrawals.count} confirmed`}
          />
        </div>
      </section>

      {/*
        Per table, not pooled. The spec asks for it this way and the accounts
        are keyed that way — an aggregate would hide the thing worth watching,
        which is one table's pool behaving unlike the others.
      */}
      {d.jackpotByTable.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">
            Jackpot pools by table
          </h2>
          <div className="overflow-x-auto rounded-(--radius-app) border border-border bg-surface">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border/50 text-[0.6rem] uppercase text-dim">
                  <th className="px-3 py-2 font-semibold">Table</th>
                  <th className="px-3 py-2 text-right font-semibold">Mini</th>
                  <th className="px-3 py-2 text-right font-semibold">Minor</th>
                  <th className="px-3 py-2 text-right font-semibold">Major</th>
                  <th className="px-3 py-2 text-right font-semibold">Grand</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {d.jackpotByTable.map((t) => (
                  <tr key={t.tableId}>
                    <td className="px-3 py-2 font-mono text-[0.66rem]">{t.tableId}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-dim">
                      {moneyFromDecimal(t.mini)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-dim">
                      {moneyFromDecimal(t.minor)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-dim">
                      {moneyFromDecimal(t.major)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-dim">
                      {moneyFromDecimal(t.grand)}
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">
                      {moneyFromDecimal(t.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">
          Circuit breakers
        </h2>
        <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
          {d.breakers.map((b) => (
            <BreakerRow key={b.id} breaker={b} />
          ))}
        </ul>
        <p className="mt-2 px-1 text-[0.66rem] leading-relaxed text-dim">
          A breaker marked <span className="font-semibold">not running</span> has its logic
          written but no live data feed. It is not protecting anything yet.
        </p>
      </section>

      <p className="px-1 text-[0.62rem] text-dim">
        As of {new Date(d.at).toLocaleString()}
      </p>
    </div>
  );
}

/**
 * One figure.
 *
 * The count-up the doc asks for runs on the NUMERIC part only, and is skipped
 * entirely under `prefers-reduced-motion`. Money is never animated: a balance
 * ticking upward through values it never held is a small lie on the screen
 * where an operator is least able to afford one.
 */
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const reduceMotion = useReducedMotion();
  const isPlainNumber = /^\d+$/.test(value);
  const shown = useCountUp(isPlainNumber && !reduceMotion ? Number(value) : null, value);

  return (
    <div className="rounded-(--radius-app) border border-border bg-surface p-4">
      <div className="text-[0.62rem] font-semibold uppercase tracking-wide text-dim">{label}</div>
      <div className="mt-1.5 text-xl font-black tabular-nums">{shown}</div>
      {hint && <div className="mt-0.5 text-[0.6rem] text-dim">{hint}</div>}
    </div>
  );
}

/** Counts once from zero to `target`. Returns `fallback` when not animating. */
function useCountUp(target: number | null, fallback: string): string {
  const [n, setN] = useState(target ?? 0);

  useEffect(() => {
    if (target === null || target === 0) return;
    const start = performance.now();
    const duration = 420;
    let frame = 0;

    const tick = (now: number): void => {
      const progress = Math.min(1, (now - start) / duration);
      // Ease-out, so it settles rather than stopping dead.
      setN(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return target === null ? fallback : String(n);
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
      {/*
        Three states, and the middle one is the one that matters: a breaker
        that is not running is neither healthy nor tripped, and rendering it
        green would advertise protection that is not there.
      */}
      <Badge tone={notRunning ? 'neutral' : tripped ? 'warn' : 'success'}>
        {notRunning ? 'not running' : tripped ? 'tripped' : 'armed'}
      </Badge>
    </li>
  );
}

/** ACCOUNT_TYPE → something a human reads. */
function label(accountType: string): string {
  return accountType
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
