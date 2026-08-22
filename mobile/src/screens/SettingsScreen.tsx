import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { useAuth } from '../auth';
import { space, theme } from '../theme';
import { Button, Card, ListRow, Screen, Toggle } from '../ui';

/**
 * Settings — account-scoped preferences, ported from frontend/src/pages/Settings.tsx.
 *
 * Left out of this port, deliberately, because the pieces they depend on do
 * not exist in the shell yet: the web page's Appearance section (theme is
 * dark-only here, see theme.ts) and its language picker (LanguageSheet is a
 * web component; mobile's i18n.ts reads the device language once at start and
 * says switching languages "belongs with [Settings], not here" — a picker for
 * a future change, not this one). What's here — Preferences, Notifications and
 * the sign-out control at the bottom — is everything this screen can honestly
 * do today.
 *
 * The rule this screen exists to honour: a toggle must never show a confident
 * value before the real one has loaded. Every Toggle below is rendered only
 * inside Screen's success branch, so there is no default to get wrong.
 */

interface PlayerSettings {
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
          </>
        )}
      </Screen>

      {/* Deliberately outside Screen: an expired session is exactly when
          someone needs to sign out, and that is the case where the settings
          query fails. Gating this button on that query succeeding would trap
          the player behind the error state with no way back to login. */}
      <View style={styles.footer}>
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
  container: { flex: 1, backgroundColor: theme.bg },
  section: { gap: space.sm },
  sectionTitle: { paddingHorizontal: space.xs, color: theme.dim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  sectionCard: { padding: 0, paddingHorizontal: space.md, gap: 0 },
  footer: { paddingHorizontal: space.lg, paddingBottom: space.lg },
});
