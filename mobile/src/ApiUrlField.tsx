import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { BUILD_API_URL, OVERRIDE_ALLOWED, clearApiOverride, getApiOverride, setApiOverride } from './apiConfig';
import { radius, space, theme } from './theme';
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
export function ApiUrlField() {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<'saved' | 'reset' | null>(null);

  useEffect(() => {
    if (!OVERRIDE_ALLOWED) return;
    void getApiOverride().then((override) => setValue(override ?? ''));
  }, []);

  if (!OVERRIDE_ALLOWED) return null;

  const save = (): void => {
    void setApiOverride(value).then(() => setStatus('saved'));
  };

  const reset = (): void => {
    void clearApiOverride().then(() => {
      setValue('');
      setStatus('reset');
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
      {status !== null && (
        <Text style={styles.status}>{status === 'saved' ? 'Saved — restart the app' : 'Reset — restart the app'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.xs },
  heading: { color: theme.dim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: theme.text,
    fontSize: 15,
  },
  row: { flexDirection: 'row', gap: space.sm },
  status: { color: theme.dim, fontSize: 11 },
});
