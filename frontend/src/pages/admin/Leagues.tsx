import { useTranslation } from 'react-i18next';
import { Shield, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAdminLeagues } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { moneyFromDecimal } from '@/lib/money';

/**
 * Admin — Leagues.
 *
 * Every league with its own inventory, rake and insurance reserve. Per league,
 * never pooled: §3.1 makes the platform and each league separate fund systems
 * with no cross-subsidy, so a combined total would describe a pool that does
 * not exist and hide the ones that do.
 *
 * Read-only for now, deliberately. SAMUEL.md describes top-up and cash-out
 * actions here, but nothing in the backend performs either — the ledger types
 * (LEAGUE_TOPUP, LEAGUE_CASHOUT) and the clearing paths exist, the transfer
 * does not. Rendering buttons over an unbuilt money path would be the same
 * mistake as a two-step confirm that confirms nothing.
 */
export function AdminLeagues() {
  const { t } = useTranslation();
  const leagues = useAdminLeagues();

  if (leagues.isPending) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-(--radius-app)" />
        ))}
      </div>
    );
  }

  if (leagues.isError) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <ErrorState message={t(errorKey(leagues.error))} onRetry={() => void leagues.refetch()} />
      </div>
    );
  }

  if (leagues.data.leagues.length === 0) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <EmptyState
          icon={Shield}
          title="No leagues yet"
          description="Leagues appear here as players create them."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {leagues.data.leagues.map((l) => (
        <div key={l.leagueId} className="rounded-(--radius-app) border border-border bg-surface p-4">
          <div className="flex items-start gap-3">
            <div
              className="grid size-9 shrink-0 place-items-center rounded-xl text-white"
              style={{ backgroundImage: 'var(--brand-gradient)' }}
            >
              <Shield size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-bold">{l.name}</span>
                {l.inviteOnly && <Lock size={11} className="shrink-0 text-dim" />}
              </div>
              <div className="truncate font-mono text-[0.6rem] text-dim">{l.leagueId}</div>
            </div>
            <Badge tone="neutral">
              {l.memberCount} {l.memberCount === 1 ? 'member' : 'members'}
            </Badge>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <Figure label="Inventory" value={moneyFromDecimal(l.inventory)} />
            <Figure label="Rake taken" value={moneyFromDecimal(l.rake)} />
            {/*
              A league's insurance is its own. §3.1: separate systems, no
              cross-subsidy — a league cannot underwrite from the platform's
              pool, so showing the platform's figure here would be a lie about
              what backs its tables.
            */}
            <Figure label="Insurance" value={moneyFromDecimal(l.insurance)} />
          </div>
        </div>
      ))}

      <p className="flex items-start gap-1.5 px-1 text-[0.62rem] leading-relaxed text-dim">
        <Lock size={11} className="mt-0.5 shrink-0" />
        Read-only. Top-up and cash-out move money between the treasury and a league's inventory;
        that path is not built yet, and buttons over an unbuilt path would imply an action that
        does nothing.
      </p>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2.5 py-2">
      <div className="text-[0.55rem] uppercase tracking-wide text-dim">{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}
