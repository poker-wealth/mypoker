import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Lock, ChevronRight, Crown } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/lib/toast';
import { useConfirmSheet } from '@/components/ui/ConfirmSheet';
import {
  useAdminLeagues,
  useLeagueDetail,
  useLeagueFunding,
  useLeagueFundingActions,
} from '@/api/hooks';
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
 * Top-up and cash-out are here now that the path behind them exists. Both are
 * requests, not transfers: the money moves at execution, after a separate
 * review, and a large movement in either direction needs a second person (W10:
 * "top-up and cash-out workflow with second-person confirmation"). The UI
 * mirrors that rather than flattening it into a button — a confirm dialog that
 * fires a transfer is how one careless click empties a treasury.
 *
 * Every actor comes from the signed-in token server-side; nothing here names
 * an approver, because an approval the client fills in is not an approval.
 */
export function AdminLeagues() {
  const { t } = useTranslation();
  const leagues = useAdminLeagues();
  const [action, setAction] = useState<PendingAction | null>(null);
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);

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
          <button
            onClick={() => setSelectedLeague(l.leagueId)}
            className="-m-1 flex w-[calc(100%+0.5rem)] items-start gap-3 rounded-lg p-1 text-left transition-colors hover:bg-surface-2"
          >
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
            <ChevronRight size={15} className="mt-1 shrink-0 text-dim" />
          </button>

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

          <div className="mt-3 flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setAction({ league: l, kind: 'TOPUP' })}>
              Top up
            </Button>
            <Button variant="ghost" className="flex-1" onClick={() => setAction({ league: l, kind: 'CASHOUT' })}>
              Cash out
            </Button>
          </div>
        </div>
      ))}

      <FundingQueue />

      <p className="flex items-start gap-1.5 px-1 text-[0.62rem] leading-relaxed text-dim">
        <Lock size={11} className="mt-0.5 shrink-0" />
        Requests move no money. A separate review executes them, and a top-up over $10,000 needs a
        second administrator.
      </p>

      <RequestSheet action={action} onClose={() => setAction(null)} />

      <Modal
        open={selectedLeague !== null}
        onClose={() => setSelectedLeague(null)}
        title="Club"
        className="max-w-lg"
      >
        {selectedLeague && <LeagueDetailView leagueId={selectedLeague} />}
      </Modal>
    </div>
  );
}

/** A club in full — owner, members, settings and its own money. Read-only. */
function LeagueDetailView({ leagueId }: { leagueId: string }) {
  const { t } = useTranslation();
  const detail = useLeagueDetail(leagueId);

  if (detail.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (detail.isError) {
    return <ErrorState message={t(errorKey(detail.error))} onRetry={() => void detail.refetch()} />;
  }

  const d = detail.data;
  const ownerName = d.owner.displayName ?? d.owner.email ?? d.owner.playerId;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-1.5">
          <span className="text-base font-black">{d.name}</span>
          {d.inviteOnly && <Lock size={12} className="text-dim" />}
        </div>
        <div className="mt-0.5 break-all font-mono text-[0.62rem] text-dim">{d.leagueId}</div>
        {d.description && <p className="mt-1 text-xs text-dim">{d.description}</p>}
        <div className="mt-1 flex items-center gap-1.5 text-[0.66rem] text-dim">
          <Crown size={12} className="text-brand" /> Owner: <span className="text-text">{ownerName}</span>
        </div>
      </div>

      {/* This club's own money — never the platform's, never another club's. */}
      <div className="grid grid-cols-3 gap-2">
        <Figure label="Inventory" value={moneyFromDecimal(d.inventory)} />
        <Figure label="Rake taken" value={moneyFromDecimal(d.rake)} />
        <Figure label="Insurance" value={moneyFromDecimal(d.insurance)} />
      </div>

      {d.settings && (
        <div className="grid grid-cols-2 gap-2">
          <Figure label="Rake" value={`${(d.settings.rakeBps / 100).toFixed(2)}%`} />
          <Figure label="Buy-in" value={String(d.settings.buyIn)} />
          <Figure label="Table hours" value={`${d.settings.tableHours}h`} />
          <Figure label="Spectators" value={d.settings.spectatorsAllowed ? 'Allowed' : 'Off'} />
        </div>
      )}

      {d.pendingRakeChange && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[0.66rem] leading-relaxed text-dim">
          Rake change to {(d.pendingRakeChange.rakeBps / 100).toFixed(2)}% takes effect{' '}
          {new Date(d.pendingRakeChange.effectiveAt).toLocaleString()} (7-day transition).
        </p>
      )}

      <div>
        <h3 className="mb-1.5 text-[0.6rem] font-bold uppercase tracking-wide text-dim">
          Members ({d.members.length})
        </h3>
        <div className="overflow-hidden rounded-(--radius-app) border border-border">
          <ul className="divide-y divide-border">
            {d.members.map((m) => (
              <li key={m.playerId} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {m.displayName ?? m.email ?? m.playerId}
                  </div>
                  <div className="truncate font-mono text-[0.58rem] text-dim">{m.playerId}</div>
                </div>
                <Badge tone={m.role === 'OWNER' ? 'brand' : m.role === 'ADMIN' ? 'accent' : 'neutral'}>
                  {m.role.toLowerCase()}
                </Badge>
                <span className="shrink-0 text-[0.58rem] text-dim">
                  {new Date(m.joinedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-[0.62rem] leading-relaxed text-dim">
        <Lock size={11} className="mt-0.5 shrink-0" />
        Read-only. A member's own balance is theirs — this shows the club's money and roster, never a
        member's wallet. Live tables aren't shown here yet.
      </p>
    </div>
  );
}

interface PendingAction {
  league: { leagueId: string; name: string; inventory: string };
  kind: 'TOPUP' | 'CASHOUT';
}

/**
 * Raise a request. Deliberately not a confirm-and-transfer.
 *
 * The sheet says plainly that nothing moves yet, because an admin who believes
 * they have just funded a league will not go back and execute it — and the
 * league will sit unfunded while everyone assumes otherwise.
 */
function RequestSheet({ action, onClose }: { action: PendingAction | null; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const { topUp, cashOut } = useLeagueFundingActions();
  const isTopUp = action?.kind === 'TOPUP';
  const busy = topUp.isPending || cashOut.isPending;

  const submit = (): void => {
    if (!action) return;
    const done = {
      onSuccess: () => {
        toast.success('Request raised. It moves no money until executed.');
        setAmount('');
        setAddress('');
        onClose();
      },
      onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Request failed'),
    };
    if (isTopUp) topUp.mutate({ leagueId: action.league.leagueId, amount }, done);
    else cashOut.mutate({ leagueId: action.league.leagueId, amount, address }, done);
  };

  return (
    <Modal
      open={action !== null}
      onClose={onClose}
      title={isTopUp ? 'Top up a league' : 'Cash out a league'}
    >
      {action && (
        <div className="space-y-3">
          <div className="text-xs text-dim">
            {action.league.name} · holds {moneyFromDecimal(action.league.inventory)}
          </div>

          <Input
            value={amount}
            onChange={setAmount}
            placeholder="Amount, e.g. 5000.00"
            inputMode="decimal"
          />

          {!isTopUp && (
            <Input
              value={address}
              onChange={setAddress}
              placeholder="TRC-20 payout address"
            />
          )}

          <p className="rounded-lg bg-surface-2 px-3 py-2 text-[0.66rem] leading-relaxed text-dim">
            {isTopUp
              ? 'This records a request only. Confirm the TRC-20 receipt before executing it, and a top-up over $10,000 needs a second administrator.'
              : "This records a request only. A league may raise one cash-out per 24 hours, and the amount is checked against the league's balance at execution."}
          </p>

          <Button full disabled={!amount || (!isTopUp && !address) || busy} onClick={submit}>
            Raise request
          </Button>
        </div>
      )}
    </Modal>
  );
}

/** Outstanding requests, and the actions that resolve them. */
function FundingQueue() {
  const queue = useLeagueFunding();
  const { approve, reject, execute } = useLeagueFundingActions();
  const { confirm, prompt, sheet: confirmSheet } = useConfirmSheet();

  if (!queue.isSuccess || queue.data.requests.length === 0) return null;

  return (
    <>
    <section>
      <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">
        Awaiting review
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
        {queue.data.requests.map((r) => (
          <li key={r._id} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-bold">
                {r.kind === 'TOPUP' ? 'Top up' : 'Cash out'} {moneyFromDecimal(r.amount)}
              </span>
              <Badge tone={r.state === 'APPROVED' ? 'success' : 'neutral'}>
                {r.state.toLowerCase()}
              </Badge>
            </div>
            <div className="mt-0.5 truncate text-[0.62rem] text-dim">
              {r.leagueId} · asked by {r.requestedBy}
              {r.address ? ` · ${r.address}` : ''}
            </div>
            {/*
              Naming the approvers, not counting them. "1 approval" tells an
              administrator nothing about whether THEY were the one, and the
              rule is a second person rather than a second click.
            */}
            {r.approvals.length > 0 && (
              <div className="mt-0.5 text-[0.6rem] text-dim">
                approved by {r.approvals.join(', ')}
              </div>
            )}

            <div className="mt-2 flex gap-2">
              {r.state === 'REQUESTED' && (
                <>
                  <Button
                    variant="ghost"
                    className="flex-1"
                    onClick={() =>
                      approve.mutate(r._id, {
                        onSuccess: (res) =>
                          toast.success(
                            res.applied
                              ? 'Approved. Execute it to move the money.'
                              : 'Recorded. A second administrator must also approve.',
                          ),
                        onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    className="flex-1"
                    onClick={() =>
                      void (async () => {
                        const reason = await prompt({
                          title: 'Refuse funding request',
                          confirmLabel: 'Refuse',
                          danger: true,
                          withInput: { label: 'Reason', placeholder: 'why this is refused', required: true },
                        });
                        if (!reason) return;
                        reject.mutate(
                          { id: r._id, reason },
                          { onSuccess: () => toast.success('Rejected.') },
                        );
                      })()
                    }
                  >
                    Reject
                  </Button>
                </>
              )}
              {r.state === 'APPROVED' && (
                <Button
                  full
                  onClick={() =>
                    void (async () => {
                      // The only button on this screen that moves money, so it is
                      // the only one that asks twice.
                      const ok = await confirm({
                        title: 'Execute funding',
                        confirmLabel: 'Move the money',
                        danger: true,
                        body: (
                          <>
                            Move <strong className="text-text">{moneyFromDecimal(r.amount)}</strong> now?
                            <br />
                            This writes to the ledger.
                          </>
                        ),
                      });
                      if (!ok) return;
                      execute.mutate(r._id, {
                        onSuccess: () => toast.success('Executed. The ledger has been written.'),
                        onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
                      });
                    })()
                  }
                >
                  Execute
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
    {confirmSheet}
    </>
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
