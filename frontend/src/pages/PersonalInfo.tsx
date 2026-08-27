import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Loader2, Mail, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useChangeDisplayName, useChangePassword, useSelfProfile } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { ApiError } from '@/api/client';
import { useSession } from '@/store/session';
import { toast } from '@/store/toast';

/** Must match MAX_DISPLAY_NAME_LENGTH on the gateway (credential-rules.ts). */
const MAX_DISPLAY_NAME_LENGTH = 40;

/** Must match MIN_PASSWORD_LENGTH on the gateway, and `auth.passwordTooShort`. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Personal Info — the screen the Profile page's "Personal Info" row actually
 * meant to reach. It used to land on Settings (appearance/notifications),
 * which has nothing to do with who the account IS; this is that missing
 * screen, for the things about identity the gateway lets a player see or
 * change themselves: display name, email (read-only), and password.
 */
export function PersonalInfo() {
  const player = useSession((s) => s.player);
  const { t } = useTranslation();

  if (!player) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <EmptyState icon={Mail} title={t('personalInfo.signInRequired')} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DisplayNameSection displayName={player.displayName} />
      <EmailSection />
      <PasswordSection />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">{title}</h2>
      <div className="overflow-hidden rounded-(--radius-app) border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}

// ── Display name ─────────────────────────────────────────────────────────────

function DisplayNameSection({ displayName }: { displayName: string }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(displayName);
  const changeDisplayName = useChangeDisplayName();

  const trimmed = value.trim();
  const dirty = trimmed.length > 0 && trimmed !== displayName;

  const submit = (): void => {
    if (!dirty || changeDisplayName.isPending) return;
    changeDisplayName.mutate(trimmed, {
      onSuccess: () => toast.success(t('personalInfo.displayNameSaved')),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : t('personalInfo.saveFailed')),
    });
  };

  return (
    <Section title={t('auth.displayName')}>
      <div className="space-y-3 p-4">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          className="w-full rounded-(--radius-app) border border-border bg-surface px-3 py-2.5 text-sm text-text placeholder:text-dim focus:border-brand focus:outline-none"
        />
        <Button full disabled={!dirty || changeDisplayName.isPending} onClick={submit}>
          {changeDisplayName.isPending && <Loader2 size={16} className="animate-spin" />}
          {t('personalInfo.saveDisplayName')}
        </Button>
      </div>
    </Section>
  );
}

// ── Email ────────────────────────────────────────────────────────────────────

/**
 * Read-only, showing the real address.
 *
 * `/auth/me` is the one endpoint that reports the caller's own email (see
 * `SelfProfile` in api/auth.ts and gateway/auth.ts) — the session's cached
 * `player` deliberately doesn't carry it, so this section runs its own fetch
 * rather than reading `useSession().player`. `email` is `null` for an account
 * with no email on file (a Telegram sign-in, or a legacy phone sign-up) —
 * that is said plainly rather than rendered as an empty field or a bare dash.
 * Changing the address is still deferred, and still explained below the
 * value — that part of the original design was never about being unable to
 * show it, and remains true.
 */
function EmailSection() {
  const { t } = useTranslation();
  const self = useSelfProfile();

  return (
    <Section title={t('auth.email')}>
      <div className="flex items-start gap-2.5 p-4">
        <Mail size={16} className="mt-0.5 shrink-0 text-dim" />
        <div className="min-w-0 flex-1 space-y-1.5">
          {self.isPending ? (
            <Skeleton className="h-4 w-40" />
          ) : self.isSuccess && self.data.email ? (
            <p className="truncate text-sm font-medium text-text">{self.data.email}</p>
          ) : self.isSuccess ? (
            <p className="text-xs leading-relaxed text-dim">{t('personalInfo.emailUnavailable')}</p>
          ) : (
            // The lookup itself failed (offline, expired session) — the
            // generic state copy used elsewhere for a failed read, rather
            // than a fabricated address or a silent blank.
            <p className="text-xs leading-relaxed text-dim">{t(errorKey(self.error))}</p>
          )}
          <p className="text-xs leading-relaxed text-dim">{t('personalInfo.emailNotice')}</p>
        </div>
      </div>
    </Section>
  );
}

// ── Password ─────────────────────────────────────────────────────────────────

/**
 * Change password — or, for an account with none set, an honest explanation
 * instead of a form that cannot work.
 *
 * `/auth/me` now reports `hasPassword` (see `SelfProfile`), so this decides
 * up front which to show rather than rendering the form and waiting for a
 * failed submit to find out. `self.isPending` and `self.isError` both fall
 * back to the form: the flag simply isn't known yet (nothing has been
 * misjudged), and the server re-checks on submit regardless — the worst case
 * is a passwordless account seeing the form for one extra round trip, same
 * as before this field existed.
 *
 * The post-submit `code: 'no_password'` handling stays anyway, as a
 * fallback, NOT dead code: `hasPassword` was read at mount and can go stale
 * if the account changes in another tab (e.g. Google gets unlinked, or vice
 * versa) before this one submits — the server is still the authority at
 * submit time, and its own sentence ("This account signed in with Google and
 * has no password to change.") is shown as-is when that happens.
 */
function PasswordSection() {
  const { t } = useTranslation();
  const self = useSelfProfile();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  // Holds the server's own sentence once a `no_password` response is seen —
  // never invented client-side. See the class comment above.
  const [noPasswordMessage, setNoPasswordMessage] = useState<string | null>(null);
  const changePassword = useChangePassword();

  const canSubmit = currentPassword.length > 0 && newPassword.length >= MIN_PASSWORD_LENGTH;

  // Known up front from `hasPassword`, generic on purpose: "no password set"
  // covers both a Google-linked web account and a Telegram sign-in (which has
  // no stored document, and so no password, at all) — the client should not
  // guess which one it's looking at just from this boolean.
  const upfrontNoPassword = self.isSuccess && !self.data.hasPassword;
  const message = noPasswordMessage ?? (upfrontNoPassword ? t('personalInfo.noPasswordNotice') : null);

  const submit = (): void => {
    if (!canSubmit || changePassword.isPending) return;
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          toast.success(t('personalInfo.passwordChanged'));
          setCurrentPassword('');
          setNewPassword('');
        },
        onError: (e) => {
          const code = e instanceof ApiError ? (e.body as { code?: string } | undefined)?.code : undefined;
          if (code === 'no_password') {
            setNoPasswordMessage(e instanceof ApiError ? e.message : null);
            return;
          }
          // The server's own message where it has one (invalid_current_password,
          // account not found) — those were written to be read.
          toast.error(e instanceof ApiError ? e.message : t('personalInfo.saveFailed'));
        },
      },
    );
  };

  return (
    <Section title={t('personalInfo.passwordTitle')}>
      {self.isPending ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-9 w-full rounded-(--radius-app)" />
          <Skeleton className="h-9 w-full rounded-(--radius-app)" />
          <Skeleton className="h-9 w-full rounded-(--radius-app)" />
        </div>
      ) : message ? (
        <div className="flex items-start gap-2.5 p-4">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-dim" />
          <p className="text-xs leading-relaxed text-dim">{message}</p>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <PasswordField
            label={t('personalInfo.currentPassword')}
            value={currentPassword}
            onChange={setCurrentPassword}
            visible={showCurrent}
            onToggleVisible={() => setShowCurrent((v) => !v)}
            autoComplete="current-password"
          />
          <PasswordField
            label={t('auth.newPassword')}
            value={newPassword}
            onChange={setNewPassword}
            visible={showNew}
            onToggleVisible={() => setShowNew((v) => !v)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
          />
          <Button full disabled={!canSubmit || changePassword.isPending} onClick={submit}>
            {changePassword.isPending && <Loader2 size={16} className="animate-spin" />}
            {t('personalInfo.changePassword')}
          </Button>
        </div>
      )}
    </Section>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  visible,
  onToggleVisible,
  autoComplete,
  minLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
  autoComplete: 'current-password' | 'new-password';
  minLength?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-dim">{label}</span>
      <div className="relative mt-1">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          {...(minLength ? { minLength } : {})}
          className="w-full rounded-(--radius-app) border border-border bg-surface px-3 py-2.5 pr-10 text-sm text-text placeholder:text-dim focus:border-brand focus:outline-none"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={onToggleVisible}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center text-dim hover:text-text"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </label>
  );
}
