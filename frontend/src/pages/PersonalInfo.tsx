import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Eye, EyeOff, Loader2, Mail, ShieldAlert, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Avatar } from '@/components/ui/Avatar';
import {
  useChangeDisplayName,
  useChangePassword,
  useSelfProfile,
  useSettings,
  useUpdateSettings,
  useUploadAvatar,
} from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { ApiError } from '@/api/client';
import { useSession } from '@/store/session';
import { toast } from '@/store/toast';
import { cn } from '@/lib/cn';
import { AVATARS, type AvatarId } from '@/lib/avatars';
import type { Player } from '@/api/auth';
import { haptic } from '@/lib/telegram';

/**
 * Formats the upload route actually accepts, by magic bytes — see
 * avatar-processing.ts's `SIGNATURES`. Mirrored here only to build the file
 * picker's `accept` filter and give instant feedback on an obviously wrong
 * pick; see the class comment on `AvatarUploadSection` for why this can never
 * be the real guard.
 */
const ACCEPTED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Must match AVATAR_MAX_UPLOAD_BYTES on the gateway (me-routes.ts). */
const AVATAR_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

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
      <AvatarSection player={player} />
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

// ── Avatar ───────────────────────────────────────────────────────────────────

/**
 * Twelve curated avatars plus a "clear" tile that goes back to whatever
 * Avatar.tsx's fallback chain would otherwise show — the account photo if
 * there is one, the player's initial if not. The clear tile's own label says
 * which, so nobody has to guess what "clear" resolves to.
 *
 * Reuses useUpdateSettings — the same optimistic mutation Settings.tsx uses
 * for every other preference — rather than a second write path to the same
 * endpoint.
 *
 * A group of mutually exclusive choices: each tile is a real <button> with
 * its own accessible name (the avatar's name, translated) and aria-pressed
 * reflects selection, so a screen reader hears "pressed" rather than relying
 * on the ring/check that sighted users see. Colour alone never carries the
 * selected state — the ring plus the check badge do.
 */
function AvatarSection({ player }: { player: Player }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const update = useUpdateSettings();
  const current = settings.data?.avatarId ?? null;

  const choose = (avatarId: AvatarId | null): void => {
    if (avatarId === current || update.isPending) return;
    haptic('light');
    update.mutate({ avatarId });
  };

  const clearLabel = player.photoUrl
    ? t('personalInfo.avatarUsePhoto')
    : t('personalInfo.avatarUseInitial');

  return (
    <Section title={t('personalInfo.avatarTitle')}>
      <div
        role="group"
        aria-label={t('personalInfo.avatarTitle')}
        className="grid grid-cols-4 gap-3 p-4"
      >
        {AVATARS.map((a) => (
          <AvatarTile
            key={a.id}
            selected={current === a.id}
            label={t(`avatars.${a.id}`)}
            onClick={() => choose(a.id)}
          >
            <Avatar avatarId={a.id} name="" size={56} />
          </AvatarTile>
        ))}

        <AvatarTile selected={current === null} label={clearLabel} onClick={() => choose(null)}>
          <Avatar avatarId={null} photoUrl={player.photoUrl} name={player.displayName} size={56} />
        </AvatarTile>
      </div>

      <AvatarUploadControls />
    </Section>
  );
}

/**
 * Upload-your-own-photo — an addition to the curated grid above, not a
 * replacement. Picking a preset stays a single tap; this is for a player who
 * wants their own picture instead.
 *
 * Flow: pick a file → local preview (courtesy checks run here, see below) →
 * explicit "set as avatar" tap actually sends it → the settled settings
 * (avatarId now the `UPLOADED_AVATAR` sentinel) replace the cache, and
 * `Avatar.tsx`'s fallback chain picks it up everywhere, unprompted — Profile,
 * Settings, and the "clear" tile above all re-render from that one query,
 * so nothing here has to push the new avatar into more than one place.
 *
 * CLIENT-SIDE CHECKS ARE A COURTESY, NOT A GUARD. The size/type checks below
 * exist only so a player who picks an obviously-wrong file finds out in a
 * millisecond instead of after a round trip. They are not, and must never
 * become, the security boundary: the gateway re-validates the real format by
 * magic bytes regardless of what this file's `accept`/size checks allowed
 * through (see avatar-processing.ts) — a hand-crafted request that skips this
 * component entirely is refused there, not here. Do not remove the server
 * error handling below on the theory that "the client already checks this."
 */
function AvatarUploadControls() {
  const { t } = useTranslation();
  const upload = useUploadAvatar();
  const [pending, setPending] = useState<{ file: File; previewUrl: string } | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  // Revoke the object URL on unmount even if a preview is still pending —
  // the ref (rather than reading `pending` in the effect) keeps this a
  // mount/unmount-only effect instead of one that reruns, and revokes, every
  // time a new file is picked.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    return () => {
      if (pendingRef.current) URL.revokeObjectURL(pendingRef.current.previewUrl);
    };
  }, []);

  const onFileSelected = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    // Reset the input so choosing the same file again still fires onChange.
    e.target.value = '';
    if (!file) return;

    setClientError(null);

    if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
      setClientError(t('personalInfo.avatarWrongTypeClient'));
      return;
    }
    if (file.size > AVATAR_MAX_UPLOAD_BYTES) {
      setClientError(t('personalInfo.avatarTooLargeClient'));
      return;
    }

    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending({ file, previewUrl: URL.createObjectURL(file) });
  };

  const cancelPending = (): void => {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
    setClientError(null);
  };

  const confirmUpload = (): void => {
    if (!pending || upload.isPending) return;
    haptic('light');
    const { file, previewUrl } = pending;
    upload.mutate(
      { file, contentType: file.type },
      {
        onSuccess: () => {
          toast.success(t('personalInfo.avatarUploaded'));
          URL.revokeObjectURL(previewUrl);
          setPending(null);
        },
        onError: (e) => {
          // The server's own message where it has one — too large (413),
          // not a real image / wrong format (400), rate-limited (429) all
          // arrive with a message written to be read as-is, same convention
          // PasswordSection above follows for its own server errors. Only a
          // transport failure (no ApiError at all) falls back to generic copy.
          toast.error(e instanceof ApiError ? e.message : t('personalInfo.saveFailed'));
        },
      },
    );
  };

  if (pending) {
    return (
      <div className="space-y-2 border-t border-border p-4">
        <div className="flex items-center gap-3">
          <img
            src={pending.previewUrl}
            alt={t('personalInfo.avatarPreviewAlt')}
            className="size-14 shrink-0 rounded-full object-cover"
          />
          <div className="flex flex-1 flex-wrap gap-2">
            <Button size="sm" disabled={upload.isPending} onClick={confirmUpload}>
              {upload.isPending && <Loader2 size={16} className="animate-spin" />}
              {t('personalInfo.avatarUploadConfirm')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={upload.isPending}
              onClick={cancelPending}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
        {/* Busy state announced for assistive tech, not conveyed by the spinner alone. */}
        {upload.isPending && (
          <p role="status" aria-live="polite" className="sr-only">
            {t('personalInfo.avatarUploading')}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-border p-4">
      <div className="flex items-center gap-3">
        <label
          htmlFor="avatar-file-input"
          className="inline-flex h-9 cursor-pointer select-none items-center justify-center gap-2 rounded-(--radius-app) border border-border bg-surface-2 px-3.5 text-sm font-bold text-text"
        >
          <Upload size={16} />
          {t('personalInfo.avatarUploadLabel')}
        </label>
        <input
          id="avatar-file-input"
          type="file"
          accept={ACCEPTED_AVATAR_TYPES.join(',')}
          onChange={onFileSelected}
          className="sr-only"
        />
      </div>
      <p className="text-xs leading-relaxed text-dim">{t('personalInfo.avatarUploadHint')}</p>
      {clientError && <p className="text-xs leading-relaxed text-danger">{clientError}</p>}
    </div>
  );
}

function AvatarTile({
  selected,
  label,
  onClick,
  children,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
      className="relative flex items-center justify-center"
    >
      <span
        className={cn(
          'rounded-full ring-2 ring-offset-2 ring-offset-surface transition-shadow',
          selected ? 'ring-brand' : 'ring-transparent',
        )}
      >
        {children}
      </span>
      {selected && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full bg-brand text-white ring-2 ring-offset-surface"
        >
          <Check size={12} strokeWidth={3} />
        </span>
      )}
    </button>
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
