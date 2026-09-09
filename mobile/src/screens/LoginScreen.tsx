import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, forgotPasswordApi, resetPasswordApi } from '../api';
import { ApiUrlField } from '../ApiUrlField';
import { useAuth } from '../auth';
import { GOOGLE_ENABLED } from '../googleAuth';
import {
  EyeIcon,
  EyeOffIcon,
  HeadsetIcon,
  LockIcon,
  MailIcon,
  SendIcon,
} from '../icons';
import { radius, space, theme, weight } from '../theme';
import { Button, Card, ErrorState } from '../ui';
import appJson from '../../app.json';

/**
 * Sign-in / sign-up / confirm / password-reset, in one screen that switches
 * mode with local state — laid out after the owner's reference app: wordmark
 * up top, the support door top-right, an "Email login" tab header, hairline
 * inputs with leading icons, the square gold Log in, "Reset password?" left
 * with Sign up on the right, the Telegram pill under an OR, and the build
 * version + responsible-play line pinned to the very bottom, over the
 * blacked-down photo.
 *
 * What the reference has and this deliberately does not: a phone-login tab.
 * Owner's call — and no SMS provider exists to make one honest anyway.
 *
 * Rendered OUTSIDE the navigator (see App.tsx) — a signed-out user has
 * nowhere to navigate to yet, so this has no header and no back button.
 *
 * A sign-up does not end here any more: `/auth/signup` mints no token, so the
 * screen moves to `confirm` and only the emailed code produces a session.
 * A password reset ends back at sign-in with the email prefilled — the fresh
 * password's first use is the player's own.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Digits in a confirmation code. Must match OTP_LENGTH on the gateway. */
const CODE_LENGTH = 6;

/**
 * The other way in: the Telegram Mini App, via the bot. Mirrors the
 * frontend's config default (frontend/src/config.ts TELEGRAM_BOT_NAME) —
 * one bot, two clients. The same door serves as support (the reference's
 * headset icon), because support lives in that chat too.
 */
const TELEGRAM_URL = 'https://t.me/mypoker777_bot';

/** Seconds until `iso`, floored at zero. Zero for a missing or past date. */
function secondsUntil(iso: string | null): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
}

type Mode = 'signIn' | 'signUp' | 'confirm' | 'forgotRequest' | 'forgotReset';

export function LoginScreen() {
  const { t } = useTranslation();
  const { signIn, signUp, confirmEmail, resendCode, signInWithGoogle, error, clearError, busy } =
    useAuth();
  // Rendered outside NavigationContainer (see App.tsx), so nothing upstream applies safe-area
  // insets here the way a screen inside the navigator gets them automatically.
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  // The confirmation step. `pendingEmail` is the server's normalised spelling,
  // not what was typed — the challenge is keyed on the former.
  const [pendingEmail, setPendingEmail] = useState('');
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);

  // The password-reset steps. Its own busy flag and error text because these
  // calls bypass useAuth — they neither create nor destroy a session.
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

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
  const [showPassword, setShowPassword] = useState(false);

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

  /**
   * Reset, step 1: ask for the code. The server answers identically whether
   * or not the email exists (anti-enumeration), so success here only means
   * "if that account exists, a code is on its way" — exactly what the
   * subtitle on the next screen says.
   */
  const submitForgotRequest = (): void => {
    if (!EMAIL_RE.test(email) || resetBusy || inFlight.current) return;
    inFlight.current = true;
    setResetBusy(true);
    setResetError(null);

    void (async () => {
      try {
        await forgotPasswordApi(email.trim().toLowerCase());
        setResetCode('');
        setNewPassword('');
        setMode('forgotReset');
      } catch (err) {
        setResetError(err instanceof ApiError ? err.message : t('auth.forgotPasswordFailed'));
      } finally {
        setResetBusy(false);
        inFlight.current = false;
      }
    })();
  };

  /** Reset, step 2: the mailed code + the new password. Ends at sign-in with
   *  the email prefilled — the fresh password's first use is the player's. */
  const submitForgotReset = (): void => {
    if (resetCode.length !== CODE_LENGTH || newPassword.length < 8 || resetBusy || inFlight.current)
      return;
    inFlight.current = true;
    setResetBusy(true);
    setResetError(null);

    void (async () => {
      try {
        await resetPasswordApi(email.trim().toLowerCase(), resetCode, newPassword);
        setPassword('');
        setResetError(null);
        setMode('signIn');
      } catch (err) {
        setResetError(err instanceof ApiError ? err.message : t('auth.resetPasswordFailed'));
        setResetCode('');
      } finally {
        setResetBusy(false);
        inFlight.current = false;
      }
    })();
  };

  const openTelegram = (): void => {
    void Linking.openURL(TELEGRAM_URL).catch(() => {
      // No Telegram and no browser willing to take t.me — nothing useful to
      // do; the email form is right there.
    });
  };

  const version = appJson.expo.version;

  return (
    // Sign-up mode has three fields, an error box, and two or three buttons — on a small phone
    // with the keyboard up, a plain centred View leaves the submit button unreachable and
    // unseen. KeyboardAvoidingView + a scrolling body fixes that; `flexGrow: 1` on the content
    // container keeps the existing centred look whenever there's room to spare.
    <View style={styles.screen}>
      {/* The reference's photographic base: chips and aces anchored to the
          bottom, blacked well down (their photo reads nearly as shadow) and
          fading up into the screen so the form floats above it. */}
      <View pointerEvents="none" style={styles.backdrop}>
        <Image
          source={require('../../assets/brand/login-bg-bw.png')}
          style={styles.backdropImage}
          resizeMode="cover"
        />
        <View style={styles.backdropTint} />
        <LinearGradient colors={[theme.bg, 'transparent']} style={styles.backdropFade} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >

      {/* Support, top-right — the reference's headset. Ours opens the bot
          chat, which is where support actually answers. */}
      <Pressable
        onPress={openTelegram}
        style={[styles.supportBtn, { top: insets.top + space.sm }]}
        hitSlop={8}
      >
        <HeadsetIcon color={theme.brand} size={24} />
      </Pressable>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          // The pinned footer needs clearance, or the card's tail hides under it.
          // Increased paddingBottom to shift the entire form up a little
          { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + 260 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          {/* The wordmark speaks for itself, as on the reference — a text
              title beside it would say MYPOKER twice. The confirm step keeps
              its words: "check your email" is an instruction, not branding. */}
          <Image
            source={require('../../assets/brand/logo-gold.png')}
            style={styles.wordmark}
            resizeMode="contain"
          />
          {mode === 'confirm' && (
            <>
              <Text style={styles.title}>{t('auth.confirmTitle')}</Text>
              <Text style={styles.subtitle}>
                {t('auth.confirmSubtitle', { email: pendingEmail })}
              </Text>
            </>
          )}
          {mode === 'forgotRequest' && (
            <>
              <Text style={styles.title}>{t('auth.forgotPasswordTitle')}</Text>
              <Text style={styles.subtitle}>{t('auth.forgotPasswordSubtitle')}</Text>
            </>
          )}
          {mode === 'forgotReset' && (
            <>
              <Text style={styles.title}>{t('auth.resetPasswordTitle')}</Text>
              <Text style={styles.subtitle}>
                {t('auth.resetPasswordSubtitle', { email: email.trim().toLowerCase() })}
              </Text>
            </>
          )}
        </View>

        {/* The reference's tab strip, minus the phone tab (owner's call; no
            SMS provider to make one honest). One tab, worn as a header. */}
        {(mode === 'signIn' || mode === 'signUp') && (
          <View style={styles.tabRow}>
            <MailIcon color={theme.brand} size={16} />
            <Text style={styles.tabText}>{t('auth.emailLogin')}</Text>
          </View>
        )}

        {mode === 'confirm' ? (
          <Card style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.label}>{t('auth.confirmCode')}</Text>
              <TextInput
                style={[styles.codeBox, styles.codeInput]}
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

            <Button style={{ borderRadius: 6 }} disabled={code.length !== CODE_LENGTH || busy} onPress={submitCode}>
              {busy ? t('auth.confirming') : t('auth.confirmButton')}
            </Button>

            <Button style={{ borderRadius: 6 }} variant="ghost" disabled={resendSeconds > 0} onPress={requestNewCode}>
              {resendSeconds > 0
                ? t('auth.confirmResendIn', { seconds: resendSeconds })
                : t('auth.confirmResend')}
            </Button>

            <Button
              style={{ borderRadius: 6 }}
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
        ) : mode === 'forgotRequest' ? (
          <Card style={styles.card}>
            <View style={styles.inputRow}>
              <MailIcon color={theme.dim} size={16} />
              <TextInput
                style={styles.inputFlat}
                placeholder={t('auth.email')}
                placeholderTextColor={theme.dim}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="emailAddress"
                autoComplete="email"
              />
            </View>

            {resetError !== null && (
              <ErrorState message={resetError} retryLabel={t('common.retry')} />
            )}

            <Pressable
              onPress={submitForgotRequest}
              disabled={!EMAIL_RE.test(email) || resetBusy}
              style={styles.loginBtn}
            >
              <Text style={styles.loginBtnText}>
                {resetBusy ? t('auth.forgotPasswordSending') : t('auth.forgotPasswordSubmit')}
              </Text>
            </Pressable>

            <Button
              style={{ borderRadius: 6 }}
              variant="ghost"
              onPress={() => {
                setResetError(null);
                setMode('signIn');
              }}
            >
              {t('auth.confirmBack')}
            </Button>
          </Card>
        ) : mode === 'forgotReset' ? (
          <Card style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.label}>{t('auth.resetCode')}</Text>
              <TextInput
                style={[styles.codeBox, styles.codeInput]}
                value={resetCode}
                onChangeText={(v) => setResetCode(v.replace(/\D/g, '').slice(0, CODE_LENGTH))}
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                keyboardType="number-pad"
                maxLength={CODE_LENGTH}
                autoFocus
                placeholder="000000"
                placeholderTextColor={theme.dim}
              />
            </View>

            <View style={styles.inputRow}>
              <LockIcon color={theme.dim} size={16} />
              <TextInput
                style={styles.inputFlat}
                placeholder={t('auth.newPassword')}
                placeholderTextColor={theme.dim}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                textContentType="newPassword"
                autoComplete="new-password"
              />
            </View>

            {resetError !== null && (
              <ErrorState message={resetError} retryLabel={t('common.retry')} />
            )}

            <Pressable
              onPress={submitForgotReset}
              disabled={resetCode.length !== CODE_LENGTH || newPassword.length < 8 || resetBusy}
              style={[
                styles.loginBtn,
                (resetCode.length !== CODE_LENGTH || newPassword.length < 8 || resetBusy) &&
                  styles.btnDim,
              ]}
            >
              <Text style={styles.loginBtnText}>
                {resetBusy ? t('common.loading') : t('auth.resetPasswordSubmit')}
              </Text>
            </Pressable>

            <Button
              style={{ borderRadius: 6 }}
              variant="ghost"
              onPress={() => {
                setResetError(null);
                setMode('forgotRequest');
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

        {/* The reference's fields: hairline underlines with a leading mark,
            the hint living as the placeholder — not boxed inputs with labels. */}
        <View style={styles.inputRow}>
          <MailIcon color={theme.dim} size={16} />
          <TextInput
            style={styles.inputFlat}
            placeholder={t('auth.email')}
            placeholderTextColor={theme.dim}
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
          />
        </View>
        {emailTouched && !emailValid && <Text style={styles.invalid}>{t('auth.emailInvalid')}</Text>}

        <View style={styles.inputRow}>
          <LockIcon color={theme.dim} size={16} />
          <TextInput
            style={[styles.inputFlat, { paddingRight: 40 }]}
            placeholder={t('auth.passwordHint')}
            placeholderTextColor={theme.dim}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setPasswordTouched(true);
            }}
            onBlur={() => setPasswordTouched(true)}
            secureTextEntry={!showPassword}
            // `newPassword` is what prompts a password manager to offer a
            // generated password on sign-up; using it on sign-in would
            // instead prompt to overwrite whatever is already stored, so the
            // hint must track which form this is.
            textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          />
          <Pressable
            onPress={() => setShowPassword(!showPassword)}
            style={{ position: 'absolute', right: 0, padding: space.md }}
            hitSlop={8}
          >
            {showPassword ? (
              <EyeOffIcon color={theme.dim} size={18} />
            ) : (
              <EyeIcon color={theme.dim} size={18} />
            )}
          </Pressable>
        </View>
        {passwordTouched && !passwordValid && (
          <Text style={styles.invalid}>{t('auth.passwordTooShort')}</Text>
        )}

        {mode === 'signUp' && (
          <View style={styles.inputRow}>
            <TextInput
              style={styles.inputFlat}
              placeholder={t('auth.displayNameOptional')}
              placeholderTextColor={theme.dim}
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="words"
              textContentType="name"
              autoComplete="name"
            />
          </View>
        )}

        {/* No onRetry: retrying means resubmitting the form, which the
            submit button already does. retryLabel is a required prop on
            ErrorState but goes unused since ErrorState only renders a retry
            button when onRetry is passed. */}
        {error !== null && <ErrorState message={error} retryLabel={t('common.retry')} />}

        {/* The reference's square gold Log in — small corners, full width. */}
        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          style={styles.loginBtn}
        >
          <Text style={styles.loginBtnText}>
            {busy
              ? t('common.loading')
              : mode === 'signIn'
                ? t('auth.signIn')
                : t('auth.createAccount')}
          </Text>
        </Pressable>

        {/* The reference's row: Reset password? on the left (real — it opens
            the ported forgot flow), the mode switch pilled on the right. */}
        <View style={styles.underRow}>
          <Text
            style={styles.resetLink}
            suppressHighlighting
            onPress={() => {
              setResetError(null);
              clearError();
              setMode('forgotRequest');
            }}
          >
            {t('auth.forgotPassword')}
          </Text>
          {/* Two words, as on the reference — not a sentence. */}
          <Text style={styles.switchPill} onPress={toggleMode} suppressHighlighting>
            {mode === 'signIn' ? t('auth.signUp') : t('auth.signIn')}
          </Text>
        </View>

        {/* The other door, as on the reference: straight to the Mini App.
            The bot link works on any phone with Telegram installed. */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>{t('auth.or')}</Text>
          <View style={styles.dividerLine} />
        </View>
        <Text style={styles.telegramPill} suppressHighlighting onPress={openTelegram}>
          <SendIcon color={theme.brand} size={15} />
          {'  '}
          {t('auth.telegramLogin')}
        </Text>

      </Card>
        )}

      {/* Must live here, not just in Settings: Settings is only reachable
          after sign-in, and sign-in needs a working API URL. Without this
          control on the sign-in screen, a device build pointed at a stale
          tunnel URL is unrecoverable without a full rebuild. Renders nothing
          outside a `device` build — see ApiUrlField.tsx. */}
      <ApiUrlField />
      </ScrollView>

      {/* The reference's foot, pinned DOWN the screen over the photo — the
          real build version, then the responsible-play line at the edge. */}
      <View pointerEvents="none" style={[styles.footer, { paddingBottom: insets.bottom + 6 }]}>
        <Text style={styles.version}>{version}</Text>
        <Text style={styles.responsible}>{t('auth.responsible')}</Text>
      </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.lg, gap: space.md },
  header: { gap: space.xs, alignItems: 'center' },
  wordmark: { width: 200, height: 64 },
  title: { color: theme.text, fontSize: 20, fontFamily: weight('900'), textAlign: 'center' },
  subtitle: { color: theme.dim, fontSize: 13, lineHeight: 19, fontFamily: weight('400'), textAlign: 'center' },

  backdrop: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '70%' },
  backdropImage: { width: '100%', height: '100%' },
  // Blacked down, as the reference's photo is — theirs reads as shadow with
  // highlights, not a bright picture.
  backdropTint: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  // The fade covers the image's upper half so the photo emerges from the
  // black instead of ending at a hard edge.
  backdropFade: { position: 'absolute', left: 0, right: 0, top: 0, height: '35%' },

  supportBtn: { position: 'absolute', right: space.lg, zIndex: 10 },

  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  tabText: { color: theme.brand, fontSize: 13, fontFamily: weight('800') },

  // No panel: the reference's form sits straight on the black screen, so the
  // shared Card chrome is stripped — transparent, borderless, flat.
  card: {
    gap: space.md,
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderWidth: 0,
    elevation: 0,
    shadowOpacity: 0,
  },
  field: { gap: space.xs },
  label: { color: theme.dim, fontSize: 11, textTransform: 'uppercase', fontFamily: weight('800') },

  // The reference's hairline fields: a leading mark, the text, one thin line.
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingBottom: 6,
  },
  inputFlat: { flex: 1, color: theme.text, fontSize: 15, fontFamily: weight('400'), paddingVertical: 6, letterSpacing: 0 },
  invalid: { color: theme.danger, fontSize: 11, fontFamily: weight('400') },

  codeBox: {
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
  codeInput: { textAlign: 'center', fontSize: 22, letterSpacing: 8 },

  // Square-cornered gold, as in the picture — not a pill.
  loginBtn: {
    backgroundColor: theme.brand,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnDim: { opacity: 0.5 },
  loginBtnText: { color: theme.bg, fontSize: 14, fontFamily: weight('800') },

  underRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resetLink: {
    color: theme.brand,
    fontSize: 12,
    fontFamily: weight('400'),
    textDecorationLine: 'underline',
  },
  // The reference's Sign up: a dark pill with gold lettering — the inverse
  // of the Log in button, so the primary action keeps the only solid gold.
  switchPill: {
    color: theme.brand,
    backgroundColor: theme.surface2,
    fontSize: 12,
    fontFamily: weight('800'),
    borderRadius: 999,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    overflow: 'hidden',
  },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.border },
  dividerText: { color: theme.dim, fontSize: 11, textTransform: 'uppercase', fontFamily: weight('800') },

  telegramPill: {
    alignSelf: 'center',
    color: theme.brand,
    fontSize: 13,
    fontFamily: weight('800'),
    borderColor: theme.brand,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: space.lg,
    paddingVertical: 8,
    overflow: 'hidden',
  },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 4, paddingHorizontal: space.lg },
  version: { color: theme.brand, fontSize: 11, textAlign: 'center', fontFamily: weight('400'), opacity: 0.9 },
  responsible: {
    color: theme.dim,
    fontSize: 9.5,
    lineHeight: 14,
    textAlign: 'center',
    fontFamily: weight('400'),
    opacity: 0.85,
  },
});
