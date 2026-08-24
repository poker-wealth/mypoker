import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { BUILD_API_URL, OVERRIDE_ALLOWED, clearApiOverride, getApiOverride, setApiOverride } from './apiConfig';
import { radius, space, theme, weight } from './theme';
import { Button } from './ui';

/**
 * Lets a `device` build point the app at a fresh tunnel URL without a rebuild.
 *
 * Rendered in two places (LoginScreen and SettingsScreen) — see the comments
 * there for why both are needed. Renders nothing at all outside a `device`
 * build: `OVERRIDE_ALLOWED` is a build-time constant, so this control is
 * stripped from production, preview and development builds rather than
 * merely hidden.
 *
 * English strings are intentional here — do NOT add i18n keys. This control
 * only exists in `device` builds behind `OVERRIDE_ALLOWED`, is never shown to
 * a player, and the eight-locale rule covers user-facing copy.
 */
type Status = { kind: 'saved' } | { kind: 'reset' } | { kind: 'error'; message: string } | null;

export function ApiUrlField() {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    if (!OVERRIDE_ALLOWED) return;
    void getApiOverride().then((override) => setValue(override ?? ''));
  }, []);

  if (!OVERRIDE_ALLOWED) return null;

  const save = (): void => {
    // `setApiOverride` validates the URL and throws on a bad one. Without this
    // catch, that throw would reject a void-ed promise with no handler — an
    // unhandled rejection instead of the visible, actionable message a tester
    // needs to fix their input.
    setApiOverride(value)
      .then(() => setStatus({ kind: 'saved' }))
      .catch((err: unknown) => {
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  };

  const reset = (): void => {
    // `clearApiOverride` doesn't currently throw (it swallows its own
    // delete failures), but it shares the same void-ed `.then()` shape as
    // `save` did — catch here too so that never silently changes underfoot.
    clearApiOverride()
      .then(() => {
        setValue('');
        setStatus({ kind: 'reset' });
      })
      .catch((err: unknown) => {
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Developer — API URL</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={(v) => {
          setValue(v);
          setStatus(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder={BUILD_API_URL || 'https://…'}
        placeholderTextColor={theme.dim}
      />
      <View style={styles.row}>
        <Button onPress={save}>Save</Button>
        <Button variant="ghost" onPress={reset}>
          Reset
        </Button>
      </View>
      {status !== null && status.kind === 'error' && <Text style={styles.statusError}>{status.message}</Text>}
      {status !== null && status.kind !== 'error' && (
        <Text style={styles.status}>{status.kind === 'saved' ? 'Saved — restart the app' : 'Reset — restart the app'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.xs },
  heading: { color: theme.dim, fontSize: 11, textTransform: 'uppercase', fontFamily: weight('800') },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: theme.text,
    fontSize: 15, fontFamily: weight('400') },
  row: { flexDirection: 'row', gap: space.sm },
  status: { color: theme.dim, fontSize: 11, fontFamily: weight('400') },
  statusError: { color: theme.danger, fontSize: 11, fontFamily: weight('400') },
});
