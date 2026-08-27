import { useState } from 'react';
import { UserPlus, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAdmins, useCreateAdmin } from '@/api/hooks';
import { ApiError } from '@/api/client';
import { errorKey } from '@/api/errors';
import { useTranslation } from 'react-i18next';
import { toast } from '@/lib/toast';

/**
 * Admin — Admins.
 *
 * Where an administrator creates other administrators (the seeded default is
 * only the bootstrap). Every account made here can approve withdrawals, so the
 * screen states that plainly and holds to the same password floor the server
 * enforces. Creation is server-gated by requireAdmin; this form cannot grant
 * anything a non-ops caller could reach.
 */
export function AdminAdmins() {
  const { t } = useTranslation();
  const admins = useAdmins();
  const create = useCreateAdmin();

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().includes('@') && password.length >= 8 && !create.isPending;

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);
    create.mutate(
      { email: email.trim(), password, ...(displayName.trim() ? { displayName: displayName.trim() } : {}) },
      {
        onSuccess: ({ admin }) => {
          toast.success(`Administrator ${admin.email ?? admin.displayName ?? 'account'} created`);
          setEmail('');
          setDisplayName('');
          setPassword('');
        },
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : 'Could not create the administrator.'),
      },
    );
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-black">Administrators</h1>
        <p className="mt-0.5 text-xs text-dim">
          Accounts that can sign in to this panel and approve withdrawals. Sign-in is email + password
          only.
        </p>
      </header>

      {/* Create */}
      <section className="rounded-(--radius-app) border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold">
          <UserPlus size={16} className="text-brand" /> New administrator
        </div>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="ml-0.5 text-[0.66rem] font-semibold text-dim">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ops@mypoker777.com"
              className="h-10 w-full rounded-lg border border-border bg-black/30 px-3 text-sm text-text placeholder:text-dim focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div className="space-y-1">
            <label className="ml-0.5 text-[0.66rem] font-semibold text-dim">Display name (optional)</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Name shown in the panel"
              className="h-10 w-full rounded-lg border border-border bg-black/30 px-3 text-sm text-text placeholder:text-dim focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className="ml-0.5 text-[0.66rem] font-semibold text-dim">
              Password <span className="font-normal">(at least 8 characters)</span>
            </label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="h-10 w-full rounded-lg border border-border bg-black/30 px-3 text-sm text-text placeholder:text-dim focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger sm:col-span-2">
              {error}
            </div>
          )}

          <div className="sm:col-span-2">
            <Button disabled={!canSubmit}>
              {create.isPending ? 'Creating…' : 'Create administrator'}
            </Button>
          </div>
        </form>
      </section>

      {/* List */}
      <section>
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">
          Current administrators
        </h2>
        {admins.isPending ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-(--radius-app)" />
            ))}
          </div>
        ) : admins.isError ? (
          <div className="rounded-(--radius-app) border border-border bg-surface">
            <ErrorState message={t(errorKey(admins.error))} onRetry={() => void admins.refetch()} />
          </div>
        ) : admins.data.admins.length === 0 ? (
          <div className="rounded-(--radius-app) border border-border bg-surface px-4 py-6 text-center text-sm text-dim">
            No administrators yet.
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
            {admins.data.admins.map((a) => (
              <li key={a.playerId} className="flex items-center gap-3 px-4 py-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-full bg-brand/15 text-brand">
                  <ShieldCheck size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {a.displayName || a.email || a.playerId}
                  </div>
                  {a.email && a.displayName && (
                    <div className="truncate text-[0.66rem] text-dim">{a.email}</div>
                  )}
                </div>
                <div className="shrink-0 text-[0.62rem] text-dim">
                  {new Date(a.createdAt).toLocaleDateString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
