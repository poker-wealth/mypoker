import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Users, Lock, ChevronRight } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { UserEditor } from './UserEditor';
import { OverrideEditor } from './OverrideEditor';
import { usePlayerSearch, usePlayerDetail, useUsers } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { moneyFromDecimal, money } from '@/lib/money';
import { useDebounced } from '@/lib/useDebounced';

/**
 * Admin — Users.
 *
 * The full list of players by default, in a table, each row opening a detail.
 * A search box narrows it (by id, nickname, email or phone) — and search is the
 * only way to reach a Telegram player who has never touched money, since they
 * have neither an identity document nor a financial account to list.
 *
 * IDENTITY is editable here (see `UserEditor`). BALANCE is not, and that is
 * structural rather than hidden: there is no endpoint, hook or form that writes
 * one. The spec's acceptance criteria are explicit — "DBA direct balance update
 * attempt → MongoDB RBAC rejects" — and the way that survives a future refactor
 * is for the write path not to exist. Money moves through the audited
 * withdrawal and settlement paths.
 */

/** One table row, normalised from either the full list or a search result. */
interface UserRow {
  playerId: string;
  displayName: string | null;
  email: string | null;
  /** null only for a search hit with no financial account. */
  balance: string | null;
  joinedAt?: string;
}

export function AdminPlayers() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  // Debounced so a search runs on a typed word, not on every keystroke.
  const debounced = useDebounced(q, 300);
  const searching = debounced.trim().length >= 2;

  const search = usePlayerSearch(debounced);
  const users = useUsers(!searching); // full list only when not actively searching

  const active = searching ? search : users;
  const rows: UserRow[] = searching
    ? (search.data?.players ?? []).map((p) => ({
        playerId: p.playerId,
        displayName: p.displayName,
        email: p.email,
        balance: p.balance,
      }))
    : (users.data?.users ?? []).map((u) => ({
        playerId: u.playerId,
        displayName: u.displayName,
        email: u.email,
        balance: u.balance,
        joinedAt: u.joinedAt,
      }));

  const balancesUnavailable = searching ? search.data?.balancesUnavailable : false;
  const truncated = searching ? search.data?.truncated : users.data?.truncated;

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-black">Users</h1>
          <p className="mt-0.5 text-xs text-dim">
            {searching ? 'Search results' : 'Every player, newest first'}
          </p>
        </div>
        {!searching && users.isSuccess && (
          <span className="text-xs text-dim">
            {rows.length}
            {truncated ? '+' : ''} {rows.length === 1 ? 'user' : 'users'}
          </span>
        )}
      </header>

      <div className="flex items-center gap-2 rounded-(--radius-app) border border-border bg-surface px-3.5 py-2.5">
        <Search size={17} className="shrink-0 text-dim" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by player id, nickname, email or phone"
          spellCheck={false}
          className="w-full bg-transparent text-sm text-text placeholder:text-dim focus:outline-none"
        />
      </div>

      {/* A search-only note: how to reach Telegram players who don't list. */}
      {searching && search.data?.note && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[0.66rem] leading-relaxed text-dim">
          {search.data.note}
        </p>
      )}

      {active.isPending ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-(--radius-app)" />
          ))}
        </div>
      ) : active.isError ? (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <ErrorState message={t(errorKey(active.error))} onRetry={() => void active.refetch()} />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <EmptyState
            icon={Users}
            title={searching ? 'No match' : 'No users yet'}
            description={
              searching
                ? 'No player matched. Telegram players are findable by exact player id.'
                : 'Players appear here the first time they deposit or play.'
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-(--radius-app) border border-border bg-surface">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="border-b border-border/60 text-[0.6rem] uppercase tracking-wide text-dim">
                <th className="px-4 py-2.5 font-semibold">User</th>
                <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
                <th className="hidden px-4 py-2.5 text-right font-semibold sm:table-cell">Joined</th>
                <th className="w-8 px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr
                  key={r.playerId}
                  onClick={() => setSelected(r.playerId)}
                  className="cursor-pointer transition-colors hover:bg-surface-2"
                >
                  <td className="max-w-0 px-4 py-3">
                    <div className="truncate font-semibold">{r.displayName ?? r.playerId}</div>
                    <div className="truncate font-mono text-[0.62rem] text-dim">
                      {r.email ?? r.playerId}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-bold tabular-nums">
                      {r.balance === null ? '—' : moneyFromDecimal(r.balance)}
                    </div>
                    {r.balance === null && (
                      <div className="text-[0.56rem] text-dim">
                        {balancesUnavailable ? 'unavailable' : 'no account'}
                      </div>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-right text-[0.66rem] text-dim sm:table-cell">
                    {r.joinedAt ? new Date(r.joinedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-2 py-3 text-right">
                    <ChevronRight size={15} className="text-dim" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {truncated && (
        <p className="px-1 text-[0.66rem] text-dim">
          {searching
            ? 'Showing the first 50. Narrow the search to see more.'
            : 'Showing the most recent 200. Use search to find an older player.'}
        </p>
      )}

      <Modal open={selected !== null} onClose={() => setSelected(null)} title="User">
        {selected && <PlayerDetail playerId={selected} />}
      </Modal>
    </div>
  );
}

function PlayerDetail({ playerId }: { playerId: string }) {
  const { t } = useTranslation();
  const detail = usePlayerDetail(playerId);

  if (detail.isPending) {
    return (
      <div className="space-y-3">
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
    <div className="space-y-4">
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

      {d.override && <OverrideEditor playerId={playerId} override={d.override} />}

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

      {/*
        The balance note stays exactly as it was, now that the rest of the record
        IS editable. It has become more necessary rather than less: on a screen
        with save buttons, the one figure without one needs to say why.
      */}
      <p className="flex items-start gap-1.5 text-[0.62rem] leading-relaxed text-dim">
        <Lock size={11} className="mt-0.5 shrink-0" />
        Balances are not editable here. They move through the withdrawal and settlement
        paths, which are audited and double-entry.
      </p>

      <div className="border-t border-border pt-4">
        <UserEditor playerId={playerId} />
      </div>
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
