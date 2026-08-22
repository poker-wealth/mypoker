import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiUrlField } from '../ApiUrlField';
import { useAuth } from '../auth';
import { GOOGLE_ENABLED } from '../googleAuth';
import { radius, space, theme, weight } from '../theme';
import { Button, Card, ErrorState } from '../ui';

/**
 * Sign-in / sign-up, in one screen that toggles mode with local state.
 *
 * Rendered OUTSIDE the navigator (see App.tsx) — a signed-out user has
 * nowhere to navigate to yet, so this has no header and no back button.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginScreen() {
  const { t } = useTranslation();
  const { signIn, signUp, signInWithGoogle, error, clearError, busy } = useAuth();

  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  // Validation only shows once the user has actually typed in that field —
  // an untouched field must never look like a rejected one.
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  const emailValid = EMAIL_RE.test(email);
  const passwordValid = password.length >= 8;
  const canSubmit = emailValid && passwordValid && !busy;

  const toggleMode = (): void => {
    setMode((m) => (m === 'signIn' ? 'signUp' : 'signIn'));
    clearError();
  };

  const submit = (): void => {
    if (!canSubmit) return;
    const action =
      mode === 'signIn' ? signIn(email, password) : signUp(email, password, displayName.trim() || undefined);
    void action.catch(() => {
      // Surfaced via `error` from useAuth already; nothing else to do here.
    });
  };

  const submitGoogle = (): void => {
    void signInWithGoogle().catch(() => {
      // Surfaced via `error` from useAuth already; nothing else to do here.
    });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('auth.title')}</Text>
        <Text style={styles.subtitle}>{t('auth.subtitle')}</Text>
      </View>

      <Card style={styles.card}>
        {/* Hidden rather than disabled when GOOGLE_ENABLED is false: a
            disabled control with no explanation is worse than no control at
            all, and a build with no Google client ID configured yet is a
            developer situation, not something an end user needs to see. */}
        {GOOGLE_ENABLED && (
          <>
            <Button variant="ghost" disabled={busy} onPress={submitGoogle}>
              {t('auth.continueWithGoogle')}
            </Button>
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t('auth.or')}</Text>
              <View style={styles.dividerLine} />
            </View>
          </>
        )}

        <View style={styles.field}>
          <Text style={styles.label}>{t('auth.email')}</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setEmailTouched(true);
            }}
            onBlur={() => setEmailTouched(true)}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            autoComplete="email"
            placeholderTextColor={theme.dim}
          />
          {emailTouched && !emailValid && <Text style={styles.invalid}>{t('auth.emailInvalid')}</Text>}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t('auth.password')}</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setPasswordTouched(true);
            }}
            onBlur={() => setPasswordTouched(true)}
            secureTextEntry
            // `newPassword` is what prompts a password manager to offer a
            // generated password on sign-up; using it on sign-in would
            // instead prompt to overwrite whatever is already stored, so the
            // hint must track which form this is.
            textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            placeholderTextColor={theme.dim}
          />
          {passwordTouched && !passwordValid && (
            <Text style={styles.invalid}>{t('auth.passwordTooShort')}</Text>
          )}
        </View>

        {mode === 'signUp' && (
          <View style={styles.field}>
            <Text style={styles.label}>{t('auth.displayNameOptional')}</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="words"
              textContentType="name"
              autoComplete="name"
              placeholderTextColor={theme.dim}
            />
          </View>
        )}

        {/* No onRetry: retrying means resubmitting the form, which the
            submit button already does. retryLabel is a required prop on
            ErrorState but goes unused since ErrorState only renders a retry
            button when onRetry is passed. */}
        {error !== null && <ErrorState message={error} retryLabel={t('common.retry')} />}

        <Button disabled={!canSubmit} onPress={submit}>
          {busy ? t('common.loading') : mode === 'signIn' ? t('auth.signIn') : t('auth.createAccount')}
        </Button>

        <Button variant="ghost" onPress={toggleMode}>
          {mode === 'signIn' ? t('auth.noAccount') : t('auth.haveAccount')}
        </Button>
      </Card>

      {/* Must live here, not just in Settings: Settings is only reachable
          after sign-in, and sign-in needs a working API URL. Without this
          control on the sign-in screen, a device build pointed at a stale
          tunnel URL is unrecoverable without a full rebuild. Renders nothing
          outside a `device` build — see ApiUrlField.tsx. */}
      <ApiUrlField />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, justifyContent: 'center', padding: space.lg, gap: space.lg },
  header: { gap: space.xs },
  title: { color: theme.text, fontSize: 24, fontFamily: weight('900') },
  subtitle: { color: theme.dim, fontSize: 13, lineHeight: 19, fontFamily: weight('400') },
  card: { gap: space.md },
  field: { gap: space.xs },
  label: { color: theme.dim, fontSize: 11, textTransform: 'uppercase', fontFamily: weight('800') },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: theme.text,
    fontSize: 15, fontFamily: weight('400') },
  invalid: { color: theme.danger, fontSize: 11, fontFamily: weight('400') },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.border },
  dividerText: { color: theme.dim, fontSize: 11, textTransform: 'uppercase', fontFamily: weight('800') },
});
