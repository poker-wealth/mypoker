import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banknote, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useWithdrawalQueue, useWithdrawalActions } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { moneyFromDecimal } from '@/lib/money';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import type { QueuedWithdrawal } from '@/api/admin';

/**
 * Admin — the withdrawal review queue (SAMUEL.md task 3, screen 2).
 *
 * Over ₮10,000 the UI makes an administrator confirm twice. That confirm is a
 * courtesy, NOT the control: `approveWithdrawal` refuses a single signature
 * server-side, so a client that skipped the dialog would still be refused. The
 * doc described the backend rule as already enforced when it was not — a
 * two-step confirm over an unguarded endpoint is a control that exists only in
 * the reviewer's imagination, and this screen is built on one that is real.
 *
 * The queue is ordered oldest first. It is a queue, not a feed: the thing that
 * has waited longest is the thing to look at.
 */

/** The spec's threshold, mirrored for display only — the server decides. */
const SECOND_APPROVAL_THRESHOLD = 10_000;

type Filter = 'all' | 'large' | 'awaiting-second' | 'approved';

export function AdminWithdrawals() {
  const { t } = useTranslation();
  const queue = useWithdrawalQueue();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<QueuedWithdrawal | null>(null);

  const shown = useMemo(() => {
    const all = queue.data?.withdrawals ?? [];
    switch (filter) {
      case 'large':
        return all.filter((w) => Number(w.amount) > SECOND_APPROVAL_THRESHOLD);
      case 'awaiting-second':
        // Someone has signed and the money still cannot move. These are the
        // ones most likely to be forgotten, because they look handled.
        return all.filter(
          (w) => w.state === 'REQUESTED' && w.approvals.length > 0,
        );
      case 'approved':
        return all.filter((w) => w.state === 'APPROVED');
      default:
        return all;
    }
  }, [queue.data, filter]);

  if (queue.isPending) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-(--radius-app)" />
        ))}
      </div>
    );
  }

  if (queue.isError) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <ErrorState message={t(errorKey(queue.error))} onRetry={() => void queue.refetch()} />
      </div>
    );
  }

  const all = queue.data.withdrawals;

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {(
          [
            ['all', `All (${all.length})`],
            ['large', `Over ₮10,000`],
            ['awaiting-second', 'Awaiting 2nd'],
            ['approved', 'Held, not sent'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-[0.7rem] font-semibold',
              filter === value ? 'bg-brand text-white' : 'bg-surface-2 text-dim',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <EmptyState
            icon={Banknote}
            title={all.length === 0 ? 'Nothing awaiting review' : 'Nothing matches that filter'}
            description={
              all.length === 0
                ? 'Withdrawal requests appear here as players make them.'
                : undefined
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
          {shown.map((w) => (
            <li key={w.withdrawalId}>
              <button
                onClick={() => setSelected(w)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold tabular-nums">
                      {moneyFromDecimal(w.amount)}
                    </span>
                    <span className="shrink-0 rounded bg-surface-2 px-1 py-0.5 text-[0.55rem] font-bold text-brand">
                      {w.vipTier}
                    </span>
                    {Number(w.amount) > SECOND_APPROVAL_THRESHOLD && (
                      <ShieldAlert size={12} className="shrink-0 text-jackpot" />
                    )}
                  </div>
                  <div className="truncate font-mono text-[0.6rem] text-dim">{w.address}</div>
                  <div className="truncate text-[0.6rem] text-dim">
                    {w.playerId} · {new Date(w.requestedAt).toLocaleString()}
                  </div>
                </div>
                <StateBadge withdrawal={w} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ReviewSheet withdrawal={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function StateBadge({ withdrawal }: { withdrawal: QueuedWithdrawal }) {
  if (withdrawal.state === 'APPROVED') return <Badge tone="success">held</Badge>;
  if (withdrawal.approvals.length > 0) return <Badge tone="warn">1 of 2</Badge>;
  return <Badge tone="neutral">pending</Badge>;
}

/**
 * Approve or refuse one withdrawal.
 *
 * A large one asks twice, and the second dialog names the amount and the
 * destination rather than asking "are you sure" — someone who has clicked
 * through fifty of these needs the figure in front of them, not a reflex.
 */
function ReviewSheet({
  withdrawal,
  onClose,
}: {
  withdrawal: QueuedWithdrawal | null;
  onClose: () => void;
}) {
  const { approve, reject } = useWithdrawalActions();
  const busy = approve.isPending || reject.isPending;
  if (!withdrawal) return null;

  const isLarge = Number(withdrawal.amount) > SECOND_APPROVAL_THRESHOLD;
  const alreadySigned = withdrawal.approvals.length > 0;

  const onApprove = (): void => {
    if (
      isLarge &&
      !window.confirm(
        `${moneyFromDecimal(withdrawal.amount)} to ${withdrawal.address}.\n\n` +
          (alreadySigned
            ? 'This is the SECOND approval — it releases the funds.'
            : 'This records your approval. A second administrator must also approve before any money moves.'),
      )
    ) {
      return;
    }

    approve.mutate(withdrawal.withdrawalId, {
      onSuccess: (res) => {
        toast.success(
          res.applied
            ? 'Approved. Funds are held, ready to broadcast.'
            : 'Recorded. A second administrator must also approve.',
        );
        onClose();
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Approval failed'),
    });
  };

  return (
    <Sheet open onClose={onClose} title="Review withdrawal">
      <div className="space-y-3 py-1">
        <div>
          <div className="text-2xl font-black tabular-nums">
            {moneyFromDecimal(withdrawal.amount)}
          </div>
          <div className="mt-1 break-all font-mono text-[0.62rem] text-dim">
            {withdrawal.address}
          </div>
        </div>

        <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border text-[0.7rem]">
          <Row label="Player" value={withdrawal.playerId} mono />
          <Row label="VIP" value={`${withdrawal.vipTier} · ${withdrawal.vipTitle}`} />
          <Row label="Requested" value={new Date(withdrawal.requestedAt).toLocaleString()} />
          <Row label="State" value={withdrawal.state} />
        </div>

        {/*
          Naming who has signed, not counting. An administrator needs to know
          whether the outstanding signature is theirs to give — "1 approval"
          does not answer that, and approving your own twice does nothing.
        */}
        {alreadySigned && (
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-[0.66rem] text-dim">
            Approved by {withdrawal.approvals.join(', ')}
          </div>
        )}

        {isLarge && (
          <div className="rounded-lg bg-jackpot/10 px-3 py-2 text-[0.66rem] leading-relaxed text-jackpot">
            Over ₮10,000 — two administrators must approve. The server enforces this; it is not
            only a prompt.
          </div>
        )}

        {withdrawal.state === 'REQUESTED' && (
          <div className="flex gap-2">
            <Button className="flex-1" disabled={busy} onClick={onApprove}>
              Approve
            </Button>
            <Button
              variant="ghost"
              className="flex-1"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt('Why is this refused? The player is not told.');
                if (!reason) return;
                reject.mutate(
                  { id: withdrawal.withdrawalId, reason },
                  {
                    onSuccess: () => {
                      toast.success('Refused. Any hold has been released.');
                      onClose();
                    },
                    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
                  },
                );
              }}
            >
              Reject
            </Button>
          </div>
        )}

        {withdrawal.state === 'APPROVED' && (
          <p className="text-[0.66rem] leading-relaxed text-dim">
            Funds are held in clearing and no longer spendable. Broadcasting to the chain is a
            separate step and is not done from here.
          </p>
        )}
      </div>
    </Sheet>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <span className="text-dim">{label}</span>
      <span className={cn('truncate', mono && 'font-mono text-[0.62rem]')}>{value}</span>
    </div>
  );
}
