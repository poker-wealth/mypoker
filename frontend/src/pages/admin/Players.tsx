import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Users, Lock } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { usePlayerSearch, usePlayerDetail } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { moneyFromDecimal, money } from '@/lib/money';
import { useDebounced } from '@/lib/useDebounced';

/**
 * Admin — Players.
 *
 * Read-only, and that is enforced by there being nothing to write with: no
 * endpoint, no mutation hook, no form. The doc says "no balance editing from
 * the UI — ever", and the way that survives a future refactor is for the write
 * path not to exist rather than for it to be hidden.
 *
 * An admin who needs to move a player's money uses the withdrawal and
 * settlement paths, which are audited, idempotent and double-entry.
 */
export function AdminPlayers() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  // Debounced so a search runs on a typed word, not on every keystroke.
  const debounced = useDebounced(q, 300);
  const results = usePlayerSearch(debounced);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-(--radius-app) border border-border bg-surface px-3.5 py-2.5">
        <Search size={17} className="shrink-0 text-dim" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Player id, nickname, email or phone"
          spellCheck={false}
          className="w-full bg-transparent text-sm text-text placeholder:text-dim focus:outline-none"
        />
      </div>

      {q.trim().length < 2 && (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <EmptyState
            icon={Users}
            title="Search for a player"
            description="By player id, nickname, email or phone. At least two characters."
          />
        </div>
      )}

      {results.isPending && debounced.trim().length >= 2 && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-(--radius-app)" />
          ))}
        </div>
      )}

      {results.isError && (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <ErrorState
            message={t(errorKey(results.error))}
            onRetry={() => void results.refetch()}
          />
        </div>
      )}

      {results.isSuccess && (
        <>
          {/*
            The note explains an empty or partial result rather than leaving the
            admin to guess. "No match" and "not searchable that way" are
            different answers, and Telegram players are only the second.
          */}
          {results.data.note && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-[0.66rem] leading-relaxed text-dim">
              {results.data.note}
            </p>
          )}

          {results.data.players.length > 0 && (
            <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
              {results.data.players.map((p) => (
                <li key={p.playerId}>
                  <button
                    onClick={() => setSelected(p.playerId)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {p.displayName ?? p.playerId}
                      </div>
                      <div className="truncate font-mono text-[0.62rem] text-dim">
                        {p.email ?? p.playerId}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {/*
                        A dash, not $0.00. No account is a different fact from
                        an empty one, and an admin reading zero would conclude
                        the player had funds and spent them. And "no account" is
                        only claimed when financial-core actually ANSWERED —
                        with it down, every balance is null, and an admin
                        reading "no account" on a player holding funds would
                        act on the wrong fact entirely.
                      */}
                      <div className="text-sm font-bold tabular-nums">
                        {p.balance === null ? '—' : moneyFromDecimal(p.balance)}
                      </div>
                      {p.balance === null && (
                        <div className="text-[0.58rem] text-dim">
                          {results.data.balancesUnavailable ? 'balance unavailable' : 'no account'}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {results.data.truncated && (
            <p className="px-1 text-[0.66rem] text-dim">
              Showing the first 50. Narrow the search to see more.
            </p>
          )}
        </>
      )}

      <Sheet open={selected !== null} onClose={() => setSelected(null)} title="Player">
        {selected && <PlayerDetail playerId={selected} />}
      </Sheet>
    </div>
  );
}

function PlayerDetail({ playerId }: { playerId: string }) {
  const { t } = useTranslation();
  const detail = usePlayerDetail(playerId);

  if (detail.isPending) {
    return (
      <div className="space-y-3 py-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (detail.isError) {
    return <ErrorState message={t(errorKey(detail.error))} onRetry={() => void detail.refetch()} />;
  }

  const d = detail.data;

  return (
    <div className="space-y-4 py-1">
      <div>
        <div className="text-sm font-bold">{d.identity?.displayName ?? d.playerId}</div>
        <div className="mt-0.5 break-all font-mono text-[0.62rem] text-dim">{d.playerId}</div>
        {d.identity?.email && (
          <div className="mt-0.5 text-[0.66rem] text-dim">{d.identity.email}</div>
        )}
        {!d.identity && (
          // Worth stating: it means Telegram, not a missing record.
          <div className="mt-1 text-[0.62rem] text-dim">
            No web identity — signed in through Telegram.
          </div>
        )}
      </div>

      {!d.hasAccount ? (
        <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-[0.7rem] leading-relaxed text-dim">
          This player has no financial account yet. One is created the first time money moves,
          so this is a player who has never deposited or played for real stakes.
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border">
          <Row label="Total" value={moneyFromDecimal(d.balances.total)} strong />
          <Row label="Available" value={moneyFromDecimal(d.balances.available)} />
          <Row label="Locked at a table" value={moneyFromDecimal(d.balances.locked)} />
          <Row label="Held in withdrawal" value={moneyFromDecimal(d.balances.clearing)} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-(--radius-app) border border-border p-3">
          <div className="text-[0.6rem] uppercase tracking-wide text-dim">Reputation</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg font-black tabular-nums">{d.reputation.score}</span>
            <span className="text-[0.62rem] text-dim">
              {t(`reputation.band.${d.reputation.band}`, { defaultValue: d.reputation.band })}
            </span>
          </div>
          <div className="mt-0.5 text-[0.6rem] text-dim">
            {d.reputation.roundsPlayed} rounds
          </div>
        </div>
        <div className="rounded-(--radius-app) border border-border p-3">
          <div className="text-[0.6rem] uppercase tracking-wide text-dim">VIP</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg font-black">{d.vip.tier}</span>
            <span className="text-[0.62rem] text-dim">{d.vip.title}</span>
          </div>
          <div className="mt-0.5 text-[0.6rem] text-dim">
            {money(d.volume.cumulativeEffective)} lifetime
          </div>
        </div>
      </div>

      {d.reputation.findings.length > 0 && (
        <div>
          <div className="mb-1.5 text-[0.6rem] uppercase tracking-wide text-dim">Findings</div>
          <div className="flex flex-wrap gap-1.5">
            {d.reputation.findings.map((f, i) => (
              <Badge key={`${f}-${i}`} tone="warn">
                {f.replace(/_/g, ' ').toLowerCase()}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-[0.62rem] leading-relaxed text-dim">
        <Lock size={11} className="mt-0.5 shrink-0" />
        Read-only. Balances move through the withdrawal and settlement paths, which are
        audited and double-entry — never edited from here.
      </p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between px-3 py-2">
      <span className={strong ? 'text-xs font-bold' : 'text-xs text-dim'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-base font-black' : 'text-sm'}`}>{value}</span>
    </div>
  );
}
