import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { ApiUrlField } from '../ApiUrlField';
import { useAuth } from '../auth';
import type { RootStackParamList } from '../navigation';
import { space, theme, weight } from '../theme';
import { Button, Card, ListRow, Screen, Toggle } from '../ui';
import { DEFAULT_LANGUAGE, LANGUAGES, setLanguage } from '../i18n';

/**
 * Settings — account-scoped preferences, ported from frontend/src/pages/Settings.tsx.
 *
 * Left out of this port, deliberately, because the pieces they depend on do
 * not exist in the shell yet: the web page's Appearance section (theme is
 * dark-only here, see theme.ts). The language picker WAS also left out, on the
 * reasoning that the app followed the phone and there was nothing to choose;
 * it is here now because the app no longer does — it opens in 中文, and a
 * player who cannot read Chinese needs a way out of it. The web's About section (frontend/src/pages/Settings.tsx
 * ~181-198) is here, minus its Support row — that row opens SUPPORT_URL
 * (frontend/src/config.ts), built from env that has no mobile-side
 * equivalent (no config.ts, no VITE_SUPPORT_URL/VITE_TELEGRAM_BOT_NAME
 * plumbing), so there is no URL to open. What's here — Preferences,
 * Notifications, About and the sign-out control at the bottom — is everything
 * this screen can honestly do today.
 *
 * The rule this screen exists to honour: a toggle must never show a confident
 * value before the real one has loaded. Every Toggle below is rendered only
 * inside Screen's success branch, so there is no default to get wrong.
 */

interface PlayerSettings {
  /** BCP-47 code, or null while the account has never chosen one. */
  language: string | null;
  sound: boolean;
  haptics: boolean;
  notifyResults: boolean;
  notifyDeposits: boolean;
  notifyPromos: boolean;
}

type SettingsPatch = Partial<PlayerSettings>;

const SETTINGS_KEY = ['settings'];

export function SettingsScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { signOut } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api.get<PlayerSettings>('/me/settings'),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  // Optimistic: a toggle that waits for a round-trip before moving feels
  // broken. The server's response is the settled state and overwrites the
  // guess, so a rejected or adjusted value cannot linger in the UI.
  const update = useMutation({
    mutationFn: (patch: SettingsPatch) => api.patch<PlayerSettings>('/me/settings', patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: SETTINGS_KEY });
      const previous = queryClient.getQueryData<PlayerSettings>(SETTINGS_KEY);
      if (previous) queryClient.setQueryData<PlayerSettings>(SETTINGS_KEY, { ...previous, ...patch });
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(SETTINGS_KEY, context.previous);
    },
    onSuccess: (settled) => queryClient.setQueryData(SETTINGS_KEY, settled),
  });

  const set = (patch: SettingsPatch): void => {
    update.mutate(patch);
  };

  return (
    <View style={styles.container}>
      <Screen query={settings} errorLabel={{ retry: t('common.retry'), fallback: t('states.error') }}>
        {(data) => (
          <>
            <Section title={t('settings.preferences')}>
              <ListRow
                label={t('settings.sound')}
                right={<Toggle value={data.sound} onChange={(v) => set({ sound: v })} />}
              />
              <ListRow
                label={t('settings.haptics')}
                right={<Toggle value={data.haptics} onChange={(v) => set({ haptics: v })} />}
              />
            </Section>

            {/* THE LANGUAGE PICKER.
                This screen deliberately shipped without one, back when the app
                simply followed the phone's language — there was nothing to
                choose, so a picker would have been furniture. That reasoning
                died the moment the app started opening in 中文 for everyone
                (see i18n.ts): without this row, a player who does not read
                Chinese has no way out of it, on a screen they cannot read.

                The choice is saved to the ACCOUNT, the same field the Mini App
                writes, so picking English on the phone means English in
                Telegram too. */}
            <Section title={t('settings.language')}>
              {LANGUAGES.map((lang) => {
                const active = (data.language ?? DEFAULT_LANGUAGE) === lang.code;
                return (
                  <ListRow
                    key={lang.code}
                    label={lang.label}
                    onPress={() => {
                      // Applied immediately, then persisted — waiting for the
                      // round trip makes the tap feel broken on a slow link.
                      setLanguage(lang.code);
                      set({ language: lang.code });
                    }}
                    right={
                      active ? <Text style={styles.languageTick}>✓</Text> : null
                    }
                  />
                );
              })}
            </Section>

            <Section title={t('settings.notifications')}>
              <ListRow
                label={t('settings.notifyResults')}
                right={<Toggle value={data.notifyResults} onChange={(v) => set({ notifyResults: v })} />}
              />
              <ListRow
                label={t('settings.notifyDeposits')}
                right={<Toggle value={data.notifyDeposits} onChange={(v) => set({ notifyDeposits: v })} />}
              />
              <ListRow
                label={t('settings.notifyPromos')}
                right={<Toggle value={data.notifyPromos} onChange={(v) => set({ notifyPromos: v })} />}
              />
            </Section>

            <Section title={t('settings.about')}>
              <ListRow label={t('account.fairness')} onPress={() => navigation.navigate('Fairness')} />
            </Section>

            {/* Developer tools. `__DEV__` is false in any release build, so this section does not
                exist in a shipped app — it is not hidden, it is absent. Untranslated on purpose:
                it never reaches a player. Must stay in step with the FeltGallery route in App.tsx
                — the pair got separated in an earlier merge and this row became a dead tap. */}
            {__DEV__ && (
              <Section title="Developer">
                <ListRow label="Felt gallery" onPress={() => navigation.navigate('FeltGallery')} />
              </Section>
            )}
          </>
        )}
      </Screen>

      {/* Deliberately outside Screen: an expired session is exactly when
          someone needs to sign out, and that is the case where the settings
          query fails. Gating this button on that query succeeding would trap
          the player behind the error state with no way back to login. */}
      <View style={styles.footer}>
        {/* Renders nothing outside a `device` build (see ApiUrlField.tsx).
            Placed here, above sign-out, and outside <Screen> so it still
            renders when /me/settings fails. */}
        <ApiUrlField />

        {/* No confirmation dialog: signing out is reversible and destroys
            nothing — the token is simply dropped. */}
        <Button variant="danger" onPress={() => void signOut()}>
          {t('account.signOut')}
        </Button>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Card style={styles.sectionCard}>{children}</Card>
    </View>
  );
}

const styles = StyleSheet.create({
  /** The check beside the active language. Gold, matching every other active state. */
  languageTick: { color: theme.brand, fontSize: 15, fontFamily: weight('700') },
  container: { flex: 1, backgroundColor: theme.bg },
  section: { gap: space.sm },
  sectionTitle: { paddingHorizontal: space.xs, color: theme.dim, fontSize: 11, textTransform: 'uppercase', fontFamily: weight('800') },
  sectionCard: { padding: 0, paddingHorizontal: space.md, gap: 0 },
  footer: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
});
