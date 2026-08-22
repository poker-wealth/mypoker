import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { radius, space, theme } from './theme';
import { useDeviceIntegrity } from './integrity';

/**
 * Shown when the device fails a CRITICAL integrity probe — rooted, jailbroken,
 * or running an instrumentation framework.
 *
 * It warns; it does not block. See `integrity.ts` for why that is a deliberate
 * assumption rather than an oversight: the spec requires the detection but is
 * silent on the consequence, and refusing someone access to their own funds on
 * a heuristic is a policy decision, not a client-library one.
 *
 * WORDING. It says the device "looks modified" and advises care, because that
 * is what is actually known. It does not accuse anyone of cheating: plenty of
 * people root a phone for reasons that have nothing to do with poker, and an
 * app that calls them a fraud for it is wrong about them and insulting besides.
 *
 * It renders NOTHING until the probes have run. A warning that flashes on every
 * launch while the checks are still going teaches people to dismiss it.
 */
export function SecurityBanner() {
  const { t } = useTranslation();
  const integrity = useDeviceIntegrity();

  if (!integrity.checked || !integrity.compromised) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.title}>{t('security.deviceModifiedTitle')}</Text>
      <Text style={styles.body}>{t('security.deviceModifiedBody')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    // Danger tones, not jackpot gold: this is a warning, and gold is for
    // jackpots. It has crept into warnings twice on the web app.
    backgroundColor: 'rgba(248,86,119,0.12)',
    borderColor: 'rgba(248,86,119,0.35)',
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.xs,
  },
  title: { color: theme.danger, fontSize: 13, fontWeight: '800' },
  body: { color: theme.dim, fontSize: 11, lineHeight: 17 },
});
