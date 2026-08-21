import { useState } from 'react';
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
import { loginWithEmail, loginWithGoogle, signupWithEmail } from '../api/auth';
import { ApiError } from '../api';
import { setToken } from '../session';
import { useGoogleAuth } from '../auth/useGoogleAuth';
import { radius, space, theme } from '../theme';

/**
 * Sign in.
 *
 * Ported from `frontend/src/pages/Login.tsx` — the same three views (choose, sign in, sign up), the
 * same Google-first layout with an OR divider, the same two cards underneath.
 *
 * Mobile had NO login screen at all, which is why every authenticated screen showed "your session
 * has expired": there was no way to start one.
 *
 * The phone/email toggle the web version once had is deliberately absent here too. It changed the
 * label and then asked for a PASSWORD; nobody who taps "Phone" expects to invent one, they expect
 * an SMS code, and there is no OTP flow behind it.
 */
export function LoginScreen() {
  const [view, setView] = useState<'initial' | 'login' | 'signup'>('initial');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const google = useGoogleAuth();

  /** One place where a result becomes a session, so no path can forget to store the token. */
  const finish = async (run: () => Promise<{ token: string }>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { token } = await run();
      // Storing the token flips the app to the signed-in tree; nothing here navigates.
      await setToken(token);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = (): void => {
    setError(null);
    void google.signIn().then((accessToken) => {
      if (!accessToken) {
        if (google.error) setError(google.error);
        return;
      }
      void finish(() => loginWithGoogle(accessToken));
    });
  };

  const submit = (): void => {
    if (view === 'login') {
      void finish(() => loginWithEmail(identifier.trim(), password));
    } else {
      void finish(() =>
        signupWithEmail(identifier.trim(), password, displayName.trim() || identifier.split('@')[0] || 'Player'),
      );
    }
  };

  const canSubmit =
    identifier.trim().length > 0 && password.length > 0 && !busy;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.header}>
            <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
            <Text style={styles.brand}>MYPOKER</Text>
            <Text style={styles.tagline}>
              {view === 'signup'
                ? 'Create an account to play'
                : view === 'login'
                  ? 'Sign in with your account'
                  : 'Sign up or log in to get started'}
            </Text>
          </View>

          {view === 'initial' ? (
            <View style={styles.body}>
              <GoogleButton onPress={onGoogle} busy={busy || google.busy} ready={google.ready} />

              {!google.ready ? (
                // Say why rather than showing a button that cannot work. Google sign-in needs an
                // Android OAuth client id; without one there is nothing to open.
                <Text style={styles.googleNote}>
                  Google sign-in is not configured for this build. Use email below.
                </Text>
              ) : null}

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>OR</Text>
                <View style={styles.dividerLine} />
              </View>

              <View style={styles.choices}>
                <Pressable onPress={() => setView('login')} style={styles.choice}>
                  <Text style={styles.choiceGlyph}>✉</Text>
                  <Text style={styles.choiceText}>Sign In</Text>
                </Pressable>
                <Pressable onPress={() => setView('signup')} style={styles.choice}>
                  <Text style={styles.choiceGlyph}>＋</Text>
                  <Text style={styles.choiceText}>Sign Up</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.body}>
              <View style={styles.formHead}>
                <Pressable
                  onPress={() => {
                    setView('initial');
                    setError(null);
                  }}
                  style={styles.back}
                >
                  <Text style={styles.backGlyph}>‹</Text>
                </Pressable>
                <Text style={styles.formTitle}>
                  {view === 'login' ? 'Sign In' : 'Create Account'}
                </Text>
              </View>

              {view === 'signup' ? (
                <Field
                  label="Display name"
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="How other players see you"
                />
              ) : null}

              <Field
                label="Email"
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="you@example.com"
                keyboardType="email-address"
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                secureTextEntry
              />

              <Pressable
                onPress={submit}
                disabled={!canSubmit}
                style={[styles.primary, !canSubmit && styles.primaryOff]}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryText}>
                    {view === 'login' ? 'Sign In' : 'Create Account'}
                  </Text>
                )}
              </Pressable>
            </View>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  ...input
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...input}
        placeholderTextColor={theme.dim}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );
}

/** Google's mark, drawn rather than imported — four paths beats an icon dependency. */
function GoogleButton({
  onPress,
  busy,
  ready,
}: {
  onPress: () => void;
  busy: boolean;
  ready: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || !ready}
      style={[styles.google, (busy || !ready) && styles.googleOff]}
    >
      {busy ? (
        <ActivityIndicator color={theme.text} />
      ) : (
        <>
          <View style={styles.googleMark}>
            <Text style={styles.googleG}>G</Text>
          </View>
          <Text style={styles.googleText}>Continue with Google</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { flexGrow: 1, justifyContent: 'center', padding: space.lg },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    overflow: 'hidden',
  },
  header: { alignItems: 'center', paddingHorizontal: space.lg, paddingTop: 32, paddingBottom: space.sm },
  logo: { width: 72, height: 72, marginBottom: space.sm },
  brand: { color: theme.text, fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  tagline: { marginTop: 4, color: theme.dim, fontSize: 12 },
  body: { padding: space.lg, gap: 14 },
  google: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface2,
    paddingVertical: 12,
  },
  googleOff: { opacity: 0.5 },
  googleMark: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleG: { color: '#4285F4', fontSize: 13, fontWeight: '900' },
  googleText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  googleNote: { color: theme.dim, fontSize: 11, textAlign: 'center', lineHeight: 16 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.border },
  dividerText: { color: theme.dim, fontSize: 11, fontWeight: '700' },
  choices: { flexDirection: 'row', gap: space.md },
  choice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingVertical: 14,
  },
  choiceGlyph: { color: theme.brand, fontSize: 20 },
  choiceText: { color: theme.text, fontSize: 12, fontWeight: '700' },
  formHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  back: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: theme.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backGlyph: { color: theme.dim, fontSize: 22, lineHeight: 24 },
  formTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
  field: { gap: 4 },
  fieldLabel: { color: theme.dim, fontSize: 11, fontWeight: '600' },
  input: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.bg,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    color: theme.text,
    fontSize: 14,
  },
  primary: {
    marginTop: space.xs,
    borderRadius: radius.card,
    backgroundColor: theme.brand,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryOff: { opacity: 0.45 },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  error: {
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    color: theme.danger,
    fontSize: 12,
    textAlign: 'center',
  },
});
