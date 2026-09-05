import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, KeyRound, History, Ban, RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useConfirmSheet } from '@/components/ui/ConfirmSheet';
import {
  useAdminUserRecord,
  useAdminUserAudit,
  useAdminUserMutations,
} from '@/api/hooks';
import { errorKey, adminErrorMessage } from '@/api/errors';
import { useSession } from '@/store/session';
import type { AdminUserPatch, AdminUserRecord } from '@/api/admin';

/**
 * Admin — edit one user account.
 *
 * English literals rather than `t()`, matching every other admin screen. The
 * eight-locale rule covers the player-facing app; the ops panel has never been
 * translated, and adding half a translated surface is worse than a consistent
 * untranslated one.
 *
 * WHAT IS NOT HERE, and why — both are specification, not caution:
 *
 *   BALANCE. "DBA direct balance update attempt → MongoDB RBAC rejects" (12-week
 *   plan, acceptance criteria). A figure typed into a form leaves a balance no
 *   ledger entry explains, which `ledger-integrity.ts` then reports as a real
 *   discrepancy — indistinguishable from theft. Money moves through the
 *   withdrawal and settlement paths, which are double-entry and audited.
 *
 *   WITHDRAWAL ADDRESS. "CS attempt to modify withdrawal address via API: 403
 *   Forbidden". An administrator who can retarget a payout address is the whole
 *   insider threat model.
 *
 * The absence is load-bearing in both cases: there is no endpoint, no mutation
 * and no field, so a future refactor cannot re-expose what merely being hidden
 * would have left reachable.
 */
export function UserEditor({ playerId }: { playerId: string }) {
  const { t } = useTranslation();
  const record = useAdminUserRecord(playerId);

  if (record.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (record.isError) {
    // A 404 here is a fact worth stating rather than an error to retry: a
    // Telegram player has no identity document at all, so there is genuinely
    // nothing editable. Treating it as a failure would have an admin retrying
    // forever against a truth.
    const status = (record.error as { status?: number } | null)?.status;
    if (status === 404) {
      return (
        <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-[0.7rem] leading-relaxed text-dim">
          No web identity for this player — they signed in through Telegram. There is no
          username, email or password on file, so nothing here is editable.
        </div>
      );
    }
    return <ErrorState message={t(errorKey(record.error))} onRetry={() => void record.refetch()} />;
  }

  return <EditorForm playerId={playerId} record={record.data} />;
}

function EditorForm({ playerId, record }: { playerId: string; record: AdminUserRecord }) {
  const { t } = useTranslation();
  const { confirm, prompt, sheet } = useConfirmSheet();
  const m = useAdminUserMutations(playerId);

  const [displayName, setDisplayName] = useState(record.displayName ?? '');
  const [email, setEmail] = useState(record.email ?? '');
  const [phone, setPhone] = useState(record.phone ?? '');
  const [role, setRole] = useState(record.role);
  // Tracked separately from the record so an admin can override the automatic
  // reset that changing an address triggers — see the note under the field.
  const [emailVerified, setEmailVerified] = useState(record.emailVerified === true);
  const [error, setError] = useState<string | null>(null);

  // Whether this is the administrator's OWN account. The server refuses a
  // self-suspension; knowing it here lets the form say so instead of offering
  // a button whose only outcome is an error.
  const isSelf = useSession((s) => s.player?.playerId) === playerId;

  const emailChanged = email.trim().toLowerCase() !== (record.email ?? '').toLowerCase();
  const dirty =
    displayName !== (record.displayName ?? '') ||
    emailChanged ||
    phone !== (record.phone ?? '') ||
    role !== record.role ||
    emailVerified !== (record.emailVerified === true);

  const save = async (): Promise<void> => {
    setError(null);
    const patch: AdminUserPatch = {};
    if (displayName !== (record.displayName ?? '')) patch.displayName = displayName;
    if (phone !== (record.phone ?? '')) patch.phone = phone.trim() === '' ? null : phone;
    if (emailChanged) patch.email = email.trim() === '' ? null : email;
    if (role !== record.role) patch.role = role;
    if (emailVerified !== (record.emailVerified === true)) patch.emailVerified = emailVerified;

    // Promoting someone to administrator is confirmed separately and by name.
    // It is the one edit on this form that hands over the platform, and it
    // should not ride along in a save the admin thought was a rename.
    if (patch.role === 'ops') {
      const ok = await confirm({
        title: 'Grant administrator access?',
        body: `${record.displayName ?? playerId} will be able to edit every account, see the withdrawal queue, and grant this to others. They must sign out and back in for it to take effect.`,
        confirmLabel: 'Grant admin',
        danger: true,
      });
      if (!ok) return;
    }

    try {
      await m.update.mutateAsync(patch);
    } catch (err) {
      setError(adminErrorMessage(err, t(errorKey(err))));
    }
  };

  const toggleSuspension = async (): Promise<void> => {
    setError(null);
    const suspending = !record.suspendedAt;
    if (suspending) {
      const reason = await prompt({
        title: 'Suspend this account?',
        // Says what suspension ACTUALLY does. The previous wording — "they will
        // be signed out of every session" — was false: nothing revokes an
        // issued token, so a player already signed in keeps their session until
        // it expires. An administrator suspending someone for cheating needs to
        // know they may still be at a table right now, because that changes
        // what they do next. docs/TRAPS.md #7, in the one place an admin reads
        // before acting.
        body: 'They cannot sign in again — by password or by Google — until reinstated, and the reason is shown to them. Note: this does NOT end a session they already have. If they are signed in now, they keep that session until it expires (up to 24 hours).',
        confirmLabel: 'Suspend',
        danger: true,
        withInput: { label: 'Reason', placeholder: 'Shown to the player', required: true },
      });
      if (reason === null) return;
      try {
        await m.suspension.mutateAsync({ suspended: true, reason });
      } catch (err) {
        setError(adminErrorMessage(err, t(errorKey(err))));
      }
      return;
    }

    if (!(await confirm({ title: 'Reinstate this account?', confirmLabel: 'Reinstate' }))) return;
    try {
      await m.suspension.mutateAsync({ suspended: false });
    } catch (err) {
      setError(adminErrorMessage(err, t(errorKey(err))));
    }
  };

  const changePassword = async (): Promise<void> => {
    setError(null);
    const pw = await prompt({
      title: 'Set a new password',
      body: 'The player is not told. Give it to them over a channel you trust, and tell them to change it. This is recorded in the audit log with your name.',
      confirmLabel: 'Set password',
      danger: true,
      withInput: { label: 'New password', placeholder: 'At least 8 characters', required: true },
    });
    if (pw === null) return;
    try {
      await m.password.mutateAsync({ newPassword: pw });
    } catch (err) {
      setError(adminErrorMessage(err, t(errorKey(err))));
    }
  };

  return (
    <div className="space-y-5">
      {record.suspendedAt && (
        <div className="flex items-start gap-2 rounded-(--radius-app) border border-danger/40 bg-danger/10 px-3 py-2.5">
          <Ban size={14} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0 text-[0.7rem] leading-relaxed">
            <div className="font-bold text-danger">Suspended</div>
            {record.suspendedReason && <div className="mt-0.5">{record.suspendedReason}</div>}
            <div className="mt-0.5 text-dim">
              {new Date(record.suspendedAt).toLocaleString()}
              {record.suspendedBy && ` · by ${record.suspendedBy}`}
            </div>
          </div>
        </div>
      )}

      <Field label="Display name">
        <Input value={displayName} onChange={setDisplayName} placeholder="Display name" />
      </Field>

      <Field label="Email">
        {/* `Input` exposes text | number and inputMode text | numeric | decimal —
            no email variant either way. Left as plain text rather than widening
            a shared primitive for one admin field. */}
        <Input value={email} onChange={setEmail} placeholder="No email on file" />
        {emailChanged && email.trim() !== '' && !emailVerified && (
          /*
            Stated before saving, not discovered after. Carrying "confirmed"
            across an address change would mark an address confirmed that nobody
            has proved control of — the admin typed it, which is not the same
            thing.
          */
          <p className="mt-1.5 text-[0.62rem] leading-relaxed text-dim">
            Changing the address marks it unconfirmed. They will be asked to confirm it at
            the next sign-in. Switch confirmed back on below to override that.
          </p>
        )}
      </Field>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold">Email confirmed</div>
          <div className="text-[0.62rem] text-dim">
            {record.emailVerified === null
              ? 'Never asked — this account predates confirmation.'
              : 'Off means they must confirm before signing in.'}
          </div>
        </div>
        <Switch checked={emailVerified} onChange={setEmailVerified} label="Email confirmed" />
      </div>

      <Field label="Phone">
        <Input value={phone} onChange={setPhone} placeholder="No phone on file" />
      </Field>

      <Field label="Role">
        <div className="flex gap-1.5">
          {/*
            Two options, not three. `league_admin` was offered here and the
            server rejects it — nothing grants or reads that role yet, so the
            button could only ever produce an error. A control that cannot
            succeed does not belong on the form.
          */}
          {(['player', 'ops'] as const).map((rr) => (
            <button
              key={rr}
              onClick={() => setRole(rr)}
              className={`flex-1 rounded-(--radius-app) border px-2 py-1.5 text-[0.66rem] font-semibold ${
                role === rr
                  ? 'border-brand bg-brand/15 text-brand'
                  : 'border-border text-dim active:bg-surface-2'
              }`}
            >
              {rr === 'ops' ? 'Admin' : 'Player'}
            </button>
          ))}
        </div>
        {role === 'ops' && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[0.62rem] leading-relaxed text-dim">
            <ShieldAlert size={11} className="mt-0.5 shrink-0" />
            Full platform access, including every player record and the withdrawal queue.
          </p>
        )}
      </Field>

      {error && <p className="text-[0.7rem] text-danger">{error}</p>}

      <Button onClick={() => void save()} disabled={!dirty || m.update.isPending}>
        {m.update.isPending ? 'Saving…' : 'Save changes'}
      </Button>

      <div className="space-y-2 border-t border-border pt-4">
        <div className="text-[0.6rem] uppercase tracking-wide text-dim">Account actions</div>

        <Button
          variant="secondary"
          onClick={() => void changePassword()}
          disabled={m.password.isPending}
        >
          <KeyRound size={13} />
          {record.hasPassword ? 'Set a new password' : 'Set a password'}
        </Button>
        {!record.hasPassword && (
          // Worth saying: a Google-only account has no password to replace, and
          // setting one gives them a second way in rather than changing the first.
          <p className="text-[0.62rem] leading-relaxed text-dim">
            This account signs in with Google and has no password. Setting one adds a second
            way in; it does not replace Google.
          </p>
        )}

        <Button
          variant={record.suspendedAt ? 'secondary' : 'danger'}
          onClick={() => void toggleSuspension()}
          disabled={m.suspension.isPending || isSelf}
        >
          {record.suspendedAt ? <RotateCcw size={13} /> : <Ban size={13} />}
          {record.suspendedAt ? 'Reinstate account' : 'Suspend account'}
        </Button>
        {isSelf && (
          /*
            Said before the click, not after. The server refuses this — it would
            lock the panel behind an account that can no longer sign in to
            unlock it — but discovering that by pressing a red button and
            reading an error is a worse way to learn it. A disabled control
            needs a reason the reader can see.
          */
          <p className="text-[0.62rem] leading-relaxed text-dim">
            You cannot suspend your own account — it would lock you out of this panel with no
            way back in. Ask another administrator.
          </p>
        )}
      </div>

      <AuditTrail playerId={playerId} />

      {sheet}
    </div>
  );
}

/**
 * The audit trail for this account.
 *
 * Shown in the same drawer as the form deliberately: the record of what has been
 * done to an account belongs beside the controls that do it, so an administrator
 * about to make a change can see what the last one was.
 */
function AuditTrail({ playerId }: { playerId: string }) {
  const audit = useAdminUserAudit(playerId);

  return (
    <div className="border-t border-border pt-4">
      <div className="mb-2 flex items-center gap-1.5 text-[0.6rem] uppercase tracking-wide text-dim">
        <History size={11} />
        Admin history
      </div>

      {audit.isPending && <Skeleton className="h-12 w-full" />}

      {audit.isSuccess && audit.data.entries.length === 0 && (
        <p className="text-[0.66rem] text-dim">No administrator has changed this account.</p>
      )}

      {audit.isSuccess && audit.data.entries.length > 0 && (
        <ul className="space-y-2">
          {audit.data.entries.map((e) => (
            <li key={e.id} className="rounded-lg bg-surface-2 px-2.5 py-2 text-[0.66rem]">
              <div className="flex items-center gap-2">
                <Badge tone={e.action === 'user.suspend' ? 'warn' : 'neutral'}>
                  {e.action.replace('user.', '').replace(/_/g, ' ')}
                </Badge>
                <span className="text-dim">{new Date(e.at).toLocaleString()}</span>
              </div>
              <div className="mt-1 break-all font-mono text-[0.58rem] text-dim">
                by {e.actorPlayerId}
              </div>
              {e.reason && <div className="mt-1 italic text-dim">“{e.reason}”</div>}
              {e.after && Object.keys(e.after).length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {Object.keys(e.after).map((k) => (
                    <div key={k} className="font-mono text-[0.58rem]">
                      <span className="text-dim">{k}: </span>
                      <span className="line-through opacity-60">{fmt(e.before?.[k])}</span>
                      {' → '}
                      <span>{fmt(e.after?.[k])}</span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Render an audited value. Empty and absent are different, and both are said. */
function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (v === '') return '(empty)';
  return String(v);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[0.6rem] uppercase tracking-wide text-dim">{label}</div>
      {children}
    </div>
  );
}
