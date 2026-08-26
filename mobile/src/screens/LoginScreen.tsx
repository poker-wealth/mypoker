import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api';
import { ApiUrlField } from '../ApiUrlField';
import { useAuth } from '../auth';
import { GOOGLE_ENABLED } from '../googleAuth';
import { radius, space, theme, weight } from '../theme';
import { Button, Card, ErrorState } from '../ui';

/**
 * Sign-in / sign-up / confirm, in one screen that switches mode with local
 * state.
 *
 * Rendered OUTSIDE the navigator (see App.tsx) — a signed-out user has
 * nowhere to navigate to yet, so this has no header and no back button.
 *
 * A sign-up does not end here any more: `/auth/signup` mints no token, so the
 * screen moves to `confirm` and only the emailed code produces a session.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Digits in a confirmation code. Must match OTP_LENGTH on the gateway. */
const CODE_LENGTH = 6;

/** Seconds until `iso`, floored at zero. Zero for a missing or past date. */
function secondsUntil(iso: string | null): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
}

export function LoginScreen() {
  const { t } = useTranslation();
  const { signIn, signUp, confirmEmail, resendCode, signInWithGoogle, error, clearError, busy } =
    useAuth();
  // Rendered outside NavigationContainer (see App.tsx), so nothing upstream applies safe-area
  // insets here the way a screen inside the navigator gets them automatically.
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<'signIn' | 'signUp' | 'confirm'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  // The confirmation step. `pendingEmail` is the server's normalised spelling,
  // not what was typed — the challenge is keyed on the former.
  const [pendingEmail, setPendingEmail] = useState('');
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);

  /**
   * The real double-submit guard.
   *
   * `busy` is state, so it only becomes true on the NEXT render and two taps in
   * one frame both pass it — docs/TRAPS.md #14, where exactly this shape filed
   * two genuine withdrawal requests. A ref is set before any await. It matters
   * here because a duplicate confirm spends the code on the first request and
   * shows the second "no confirmation is pending", for a sign-up that worked.
   */
  const inFlight = useRef(false);

  // Derived from the server's timestamp rather than counted down locally, so a
  // backgrounded app comes back to the right number instead of one frozen where
  // it left off — the same class of bug as docs/TRAPS.md #16.
  useEffect(() => {
    if (!resendAt) return;
    const tick = (): void => setResendSeconds(secondsUntil(resendAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [resendAt]);

  const enterConfirm = (confirmFor: string, nextResendAt: string | null): void => {
    setPendingEmail(confirmFor);
    setResendAt(nextResendAt);
    setResendSeconds(secondsUntil(nextResendAt));
    setCode('');
    setMode('confirm');
  };

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
    if (!canSubmit || inFlight.current) return;
    inFlight.current = true;

    void (async () => {
      try {
        if (mode === 'signIn') {
          await signIn(email, password);
          return;
        }
        // Sign-up mints no session. The only way on is the code screen.
        const pending = await signUp(email, password, displayName.trim() || undefined);
        enterConfirm(pending.email, pending.resendAvailableAt);
      } catch (err) {
        // An unconfirmed account is not a failed sign-in — it is a sign-up that
        // was never finished, and the gateway has just mailed a fresh code for
        // it. Matched on the machine field, never the message: the message is
        // player-facing copy and will be reworded.
        if (err instanceof ApiError && err.status === 403 && err.detail('code') === 'email_unverified') {
          const confirmFor = err.detail<string>('email') ?? email.trim().toLowerCase();
          enterConfirm(confirmFor, err.detail<string>('resendAvailableAt') ?? null);
          // The message the store captured says "confirm your email", which is
          // now a heading rather than an error — clear it so the code screen
          // does not open with a red box on it.
          if (err.detail('sent') !== false) clearError();
        }
        // Anything else stays on this form with the error `useAuth` captured.
      } finally {
        inFlight.current = false;
      }
    })();
  };

  const submitCode = (): void => {
    if (code.length !== CODE_LENGTH || inFlight.current) return;
    inFlight.current = true;

    void (async () => {
      try {
        await confirmEmail(pendingEmail, code);
      } catch {
        // Wrong, expired, or spent — `error` from useAuth carries the server's
        // own wording, which tells those three apart. Clear the field so the
        // next attempt starts from empty rather than six wrong digits.
        setCode('');
      } finally {
        inFlight.current = false;
      }
    })();
  };

  const requestNewCode = (): void => {
    if (resendSeconds > 0 || inFlight.current) return;
    inFlight.current = true;

    void (async () => {
      try {
        const pending = await resendCode(pendingEmail);
        setResendAt(pending.resendAvailableAt);
        setResendSeconds(secondsUntil(pending.resendAvailableAt));
      } catch (err) {
        // A 429 carries the server's own countdown; adopt it rather than guess.
        const retryAfterMs =
          err instanceof ApiError ? err.detail<number>('retryAfterMs') : undefined;
        if (typeof retryAfterMs === 'number') {
          const until = new Date(Date.now() + retryAfterMs).toISOString();
          setResendAt(until);
          setResendSeconds(secondsUntil(until));
        }
      } finally {
        inFlight.current = false;
      }
    })();
  };

  const submitGoogle = (): void => {
    void signInWithGoogle().catch(() => {
      // Surfaced via `error` from useAuth already; nothing else to do here.
    });
  };

  return (
    // Sign-up mode has three fields, an error box, and two or three buttons — on a small phone
    // with the keyboard up, a plain centred View leaves the submit button unreachable and
    // unseen. KeyboardAvoidingView + a scrolling body fixes that; `flexGrow: 1` on the content
    // container keeps the existing centred look whenever there's room to spare.
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>
            {mode === 'confirm' ? t('auth.confirmTitle') : t('auth.title')}
          </Text>
          <Text style={styles.subtitle}>
            {mode === 'confirm'
              ? t('auth.confirmSubtitle', { email: pendingEmail })
              : t('auth.subtitle')}
          </Text>
        </View>

        {mode === 'confirm' ? (
          <Card style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.label}>{t('auth.confirmCode')}</Text>
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, CODE_LENGTH))}
                // `oneTimeCode` is what lets iOS offer the code straight from
                // the notification banner. `number-pad`, not `numeric`, because
                // a code has no decimal point to offer.
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                keyboardType="number-pad"
                maxLength={CODE_LENGTH}
                autoFocus
                placeholder="000000"
                placeholderTextColor={theme.dim}
              />
            </View>

            {error !== null && <ErrorState message={error} retryLabel={t('common.retry')} />}

            <Button disabled={code.length !== CODE_LENGTH || busy} onPress={submitCode}>
              {busy ? t('auth.confirming') : t('auth.confirmButton')}
            </Button>

            <Button variant="ghost" disabled={resendSeconds > 0} onPress={requestNewCode}>
              {resendSeconds > 0
                ? t('auth.confirmResendIn', { seconds: resendSeconds })
                : t('auth.confirmResend')}
            </Button>

            <Button
              variant="ghost"
              onPress={() => {
                setMode('signIn');
                setCode('');
                clearError();
              }}
            >
              {t('auth.confirmBack')}
            </Button>
          </Card>
        ) : (
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
        )}

      {/* Must live here, not just in Settings: Settings is only reachable
          after sign-in, and sign-in needs a working API URL. Without this
          control on the sign-in screen, a device build pointed at a stale
          tunnel URL is unrecoverable without a full rebuild. Renders nothing
          outside a `device` build — see ApiUrlField.tsx. */}
      <ApiUrlField />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.lg, gap: space.lg },
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
  codeInput: { textAlign: 'center', fontSize: 22, letterSpacing: 8 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.border },
  dividerText: { color: theme.dim, fontSize: 11, textTransform: 'uppercase', fontFamily: weight('800') },
});
