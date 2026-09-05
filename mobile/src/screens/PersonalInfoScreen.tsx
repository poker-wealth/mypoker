import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { api, ApiError } from '../api';
import { getApiBase } from '../apiConfig';
import { useAuth } from '../auth';
import { AVATARS, UPLOADED_AVATAR, type AvatarId } from '../lib/avatars';
import { radius, space, theme, weight } from '../theme';
import { Button, Card, EmptyState, Skeleton } from '../ui';
import { Avatar } from '../components/ui/Avatar';

/**
 * Personal Info — the native port of `frontend/src/pages/PersonalInfo.tsx`.
 *
 * The web has had this screen since the "way back into a locked account" work;
 * mobile did not, and `check:parity` failed on it by name. Four sections, the
 * same four and in the same order as the web: avatar, display name, email
 * (read-only), password.
 *
 * Everything here talks to endpoints that already exist — `PATCH /me/settings`
 * for the avatar choice, `POST /me/avatar` for an uploaded photo,
 * `POST /auth/change-display-name`, `POST /auth/change-password`, and
 * `GET /auth/me` for the email and whether a password is even set. Nothing new
 * was added to the gateway for this.
 */

/** Must match MAX_DISPLAY_NAME_LENGTH on the gateway (credential-rules.ts). */
const MAX_DISPLAY_NAME_LENGTH = 40;

/** Must match MIN_PASSWORD_LENGTH on the gateway, and `auth.passwordTooShort`. */
const MIN_PASSWORD_LENGTH = 8;

/** Must match AVATAR_MAX_UPLOAD_BYTES on the gateway (me-routes.ts). */
const AVATAR_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** What the upload route accepts by magic bytes — see avatar-processing.ts. */
const ACCEPTED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface SelfProfile {
  playerId: string;
  displayName: string;
  email: string | null;
  hasPassword: boolean;
}

interface Settings {
  avatarId: string | null;
}

export function PersonalInfoScreen() {
  const { t } = useTranslation();
  const { player } = useAuth();

  if (!player) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <EmptyState title={t('personalInfo.signInRequired')} />
      </ScrollView>
    );
  }

  return (
    // Four stacked forms with the keyboard up — the reason every input screen
    // in this app is wrapped (docs/TRAPS.md #18: the withdrawal amount field
    // sat behind the keyboard with no way to scroll to it).
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <AvatarSection />
        <DisplayNameSection displayName={player.displayName} />
        <EmailSection />
        <PasswordSection />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Card style={styles.card}>{children}</Card>
    </View>
  );
}

// ── Avatar ───────────────────────────────────────────────────────────────────

/**
 * Twelve curated avatars, a "clear" tile, and a photo upload.
 *
 * The clear tile goes back to whatever the fallback chain would otherwise
 * show — the account photo if there is one, the player's initial if not — and
 * its own label says which, so nobody has to guess what "clear" resolves to.
 */
function AvatarSection() {
  const { t } = useTranslation();
  const { player } = useAuth();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['me', 'settings'],
    queryFn: () => api.get<Settings>('/me/settings'),
  });
  const current = settings.data?.avatarId ?? null;

  const update = useMutation({
    mutationFn: (avatarId: AvatarId | null) =>
      api.patch<Settings>('/me/settings', { avatarId }),
    onSuccess: (next) => queryClient.setQueryData(['me', 'settings'], next),
  });

  const choose = (avatarId: AvatarId | null): void => {
    if (avatarId === current || update.isPending) return;
    update.mutate(avatarId);
  };

  const clearLabel = player?.photoUrl
    ? t('personalInfo.avatarUsePhoto')
    : t('personalInfo.avatarUseInitial');

  return (
    <Section title={t('personalInfo.avatarTitle')}>
      {/* What the choice below actually resolves to, through the same fallback
          chain every other surface uses. Without this the grid shows which tile
          is selected but never what an UPLOADED photo or an OAuth one looks
          like — and those are exactly the two the player cannot otherwise see. */}
      <View style={styles.avatarPreview}>
        <Avatar
          avatarId={current}
          playerId={player?.playerId}
          photoUrl={player?.photoUrl}
          name={player ? player.displayName : 'M'}
          size={72}
        />
      </View>

      <View style={styles.avatarGrid}>
        {AVATARS.map((a) => {
          const selected = current === a.id;
          return (
            <Pressable
              key={a.id}
              onPress={() => choose(a.id)}
              disabled={update.isPending}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t(`avatars.${a.id}`, { defaultValue: a.id })}
              style={[
                styles.avatarTile,
                { backgroundColor: a.colors[0], borderColor: selected ? theme.text : a.colors[1] },
                selected && styles.avatarTileSelected,
              ]}
            >
              <Text style={styles.avatarGlyph}>{a.glyph}</Text>
              {selected ? <Text style={styles.avatarCheck}>✓</Text> : null}
            </Pressable>
          );
        })}

        <Pressable
          onPress={() => choose(null)}
          disabled={update.isPending}
          accessibilityRole="button"
          accessibilityState={{ selected: current === null }}
          accessibilityLabel={clearLabel}
          style={[
            styles.avatarTile,
            styles.avatarClear,
            current === null && styles.avatarTileSelected,
          ]}
        >
          <Text style={styles.avatarClearText}>{clearLabel}</Text>
        </Pressable>
      </View>

      <AvatarUpload />
    </Section>
  );
}

/**
 * Upload a photo of your own.
 *
 * The client-side type and size checks here are CONVENIENCE, not the guard —
 * they exist to fail an obviously wrong pick instantly rather than after a
 * round trip. The real guard is the gateway, which sniffs magic bytes and
 * re-encodes (`uploads/avatar-processing.ts`); a client check on a filename or
 * a MIME string the picker reported is trivially wrong and must never be the
 * thing standing between a file and the server.
 */
function AvatarUpload() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const pick = async (): Promise<void> => {
    setError(null);

    // Android 13+ and iOS both grant a scoped, one-shot pick without a
    // permission prompt for the system picker; requesting anyway is what makes
    // the older-Android path work rather than silently returning nothing.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      // Its OWN message. This first read `avatarWrongTypeClient`, which told a
      // player who declined photo access that their file was the wrong type —
      // a false statement about what happened, and one that sends them looking
      // for a different picture instead of at their settings.
      setError(t('personalInfo.avatarPermissionDenied'));
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (picked.canceled || !picked.assets[0]) return;

    const asset = picked.assets[0];
    const mime = asset.mimeType ?? 'image/jpeg';
    if (!ACCEPTED_AVATAR_TYPES.includes(mime)) {
      setError(t('personalInfo.avatarWrongTypeClient'));
      return;
    }
    if (typeof asset.fileSize === 'number' && asset.fileSize > AVATAR_MAX_UPLOAD_BYTES) {
      setError(t('personalInfo.avatarTooLargeClient'));
      return;
    }

    setPreview(asset.uri);
    setBusy(true);
    try {
      // The route reads the EXACT posted bytes (express.raw) and sniffs their
      // real format itself, so the body has to be the file — not JSON, not a
      // base64 string. `fetch` with a blob from the local uri is the only way
      // to get those bytes onto the wire unchanged from here.
      const base = await getApiBase();
      const blob = await (await fetch(asset.uri)).blob();
      const token = await tokenHeader();
      const res = await fetch(`${base}/me/avatar`, {
        method: 'POST',
        headers: { 'content-type': mime, ...token },
        body: blob,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new ApiError(res.status, body?.error ?? t('personalInfo.saveFailed'), body);
      }
      // The uploaded photo becomes the stored choice, so the curated grid must
      // stop showing whichever tile was selected before.
      queryClient.setQueryData(['me', 'settings'], { avatarId: UPLOADED_AVATAR });
      void queryClient.invalidateQueries({ queryKey: ['me', 'settings'] });
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('personalInfo.saveFailed'));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.upload}>
      {preview ? (
        <Image source={{ uri: preview }} style={styles.preview} accessibilityIgnoresInvertColors />
      ) : null}
      {busy ? (
        <View style={styles.uploadBusy}>
          <ActivityIndicator color={theme.brand} />
          <Text style={styles.hint}>{t('personalInfo.avatarUploading')}</Text>
        </View>
      ) : (
        <Button variant="ghost" onPress={() => void pick()}>
          {t('personalInfo.avatarUploadLabel')}
        </Button>
      )}
      <Text style={styles.hint}>{t('personalInfo.avatarUploadHint')}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/** The Authorization header the raw upload needs, since it bypasses `api`. */
async function tokenHeader(): Promise<Record<string, string>> {
  const { getToken } = await import('../session');
  const token = await getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

// ── Display name ─────────────────────────────────────────────────────────────

function DisplayNameSection({ displayName }: { displayName: string }) {
  const { t } = useTranslation();
  const { refreshPlayer } = useAuth();
  const [value, setValue] = useState(displayName);
  const [notice, setNotice] = useState<string | null>(null);

  const trimmed = value.trim();
  const dirty = trimmed.length > 0 && trimmed !== displayName;

  const save = useMutation({
    mutationFn: (name: string) =>
      api.post<{ player: { displayName: string } }>('/auth/change-display-name', {
        displayName: name,
      }),
    onSuccess: () => {
      setNotice(t('personalInfo.displayNameSaved'));
      // The header and every screen reading the cached player must follow the
      // change, or the old name sits there until the next cold start.
      void refreshPlayer();
    },
    onError: (e) =>
      setNotice(e instanceof ApiError ? e.message : t('personalInfo.saveFailed')),
  });

  return (
    <Section title={t('auth.displayName')}>
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={(v) => {
            setValue(v);
            setNotice(null);
          }}
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          autoCapitalize="words"
          placeholderTextColor={theme.dim}
        />
        <Button disabled={!dirty || save.isPending} onPress={() => save.mutate(trimmed)}>
          {save.isPending ? t('common.loading') : t('personalInfo.saveDisplayName')}
        </Button>
        {notice ? <Text style={styles.hint}>{notice}</Text> : null}
      </View>
    </Section>
  );
}

// ── Email ────────────────────────────────────────────────────────────────────

/**
 * Read-only, showing the real address.
 *
 * `/auth/me` is the one endpoint that reports the caller's own email — the
 * cached player deliberately does not carry it — so this runs its own fetch.
 * `email` is null for an account with no address on file (a Telegram sign-in,
 * or a legacy phone sign-up); that is said plainly rather than rendered as an
 * empty field or a bare dash.
 */
function EmailSection() {
  const { t } = useTranslation();
  const self = useSelfProfile();

  return (
    <Section title={t('auth.email')}>
      <View style={styles.form}>
        {self.isPending ? (
          <Skeleton width={180} />
        ) : self.isSuccess && self.data.email ? (
          <Text style={styles.value}>{self.data.email}</Text>
        ) : self.isSuccess ? (
          <Text style={styles.hint}>{t('personalInfo.emailUnavailable')}</Text>
        ) : (
          // The lookup itself failed (offline, expired session) — never a
          // fabricated address, never a silent blank.
          <Text style={styles.hint}>{t('states.error')}</Text>
        )}
        <Text style={styles.hint}>{t('personalInfo.emailNotice')}</Text>
      </View>
    </Section>
  );
}

function useSelfProfile() {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<SelfProfile>('/auth/me'),
  });
}

// ── Password ─────────────────────────────────────────────────────────────────

/**
 * Change password — or, for an account with none, an honest explanation
 * instead of a form that cannot work.
 *
 * `/auth/me` reports `hasPassword`, so this decides up front rather than
 * rendering the form and waiting for a failed submit to find out. Pending and
 * failed both fall back to the form: the flag simply is not known yet, and the
 * server re-checks on submit regardless.
 *
 * The post-submit `no_password` handling stays as a fallback and is NOT dead
 * code — `hasPassword` is read at mount and can go stale (Google unlinked
 * elsewhere) before this screen submits. The server is the authority at submit
 * time and its own sentence is shown as-is.
 */
function PasswordSection() {
  const { t } = useTranslation();
  const self = useSelfProfile();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [noPasswordMessage, setNoPasswordMessage] = useState<string | null>(null);

  const canSubmit =
    currentPassword.length > 0 && newPassword.length >= MIN_PASSWORD_LENGTH;

  const upfrontNoPassword = self.isSuccess && !self.data.hasPassword;
  const message = noPasswordMessage ?? (upfrontNoPassword ? t('personalInfo.noPasswordNotice') : null);

  const change = useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api.post<unknown>('/auth/change-password', input),
    onSuccess: () => {
      setNotice(t('personalInfo.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
    },
    onError: (e) => {
      const code = e instanceof ApiError ? e.detail<string>('code') : undefined;
      if (code === 'no_password') {
        setNoPasswordMessage(e instanceof Error ? e.message : null);
        return;
      }
      setNotice(e instanceof ApiError ? e.message : t('personalInfo.saveFailed'));
    },
  });

  return (
    <Section title={t('personalInfo.passwordTitle')}>
      {self.isPending ? (
        <View style={styles.form}>
          <Skeleton width={220} />
          <Skeleton width={220} />
        </View>
      ) : message ? (
        <View style={styles.form}>
          <Text style={styles.hint}>{message}</Text>
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.label}>{t('personalInfo.currentPassword')}</Text>
          <TextInput
            style={styles.input}
            value={currentPassword}
            onChangeText={(v) => {
              setCurrentPassword(v);
              setNotice(null);
            }}
            secureTextEntry
            textContentType="password"
            autoComplete="current-password"
            placeholderTextColor={theme.dim}
          />
          <Text style={styles.label}>{t('auth.newPassword')}</Text>
          <TextInput
            style={styles.input}
            value={newPassword}
            onChangeText={(v) => {
              setNewPassword(v);
              setNotice(null);
            }}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
            placeholderTextColor={theme.dim}
          />
          <Button
            disabled={!canSubmit || change.isPending}
            onPress={() => change.mutate({ currentPassword, newPassword })}
          >
            {change.isPending ? t('common.loading') : t('personalInfo.changePassword')}
          </Button>
          {notice ? <Text style={styles.hint}>{notice}</Text> : null}
        </View>
      )}
    </Section>
  );
}

const TILE = 52;

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.bg },
  screen: { padding: space.lg, gap: space.lg, backgroundColor: theme.bg, flexGrow: 1 },
  section: { gap: space.xs },
  sectionTitle: {
    color: theme.dim,
    fontSize: 11,
    textTransform: 'uppercase',
    fontFamily: weight('800'),
  },
  card: { gap: space.md },
  form: { gap: space.sm },
  label: { color: theme.dim, fontSize: 11, textTransform: 'uppercase', fontFamily: weight('800') },
  value: { color: theme.text, fontSize: 15, fontFamily: weight('600') },
  hint: { color: theme.dim, fontSize: 12, lineHeight: 18, fontFamily: weight('400') },
  error: { color: theme.danger, fontSize: 12, fontFamily: weight('400') },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: theme.text,
    fontSize: 15,
    fontFamily: weight('400'),
  },
  avatarPreview: { alignItems: 'center' },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  avatarTile: {
    width: TILE,
    height: TILE,
    borderRadius: radius.card,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTileSelected: { borderColor: theme.text },
  avatarGlyph: { fontSize: 24 },
  avatarCheck: { position: 'absolute', bottom: 2, right: 4, color: theme.text, fontSize: 11 },
  avatarClear: {
    width: TILE * 2 + space.sm,
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    paddingHorizontal: space.xs,
  },
  avatarClearText: {
    color: theme.dim,
    fontSize: 10,
    textAlign: 'center',
    fontFamily: weight('600'),
  },
  upload: { gap: space.xs },
  uploadBusy: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  preview: { width: 72, height: 72, borderRadius: radius.card, alignSelf: 'center' },
});
