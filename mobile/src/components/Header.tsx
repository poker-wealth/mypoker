import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import type { Tab } from '../navigation';

/**
 * Route-specific header: the screen's name on the left, a contextual control on the right.
 *
 * Ported from `frontend/src/components/Header.tsx`, including its choices — Lobby carries the
 * FAIR & SECURE badge, Alliance a help affordance, Games nothing at all.
 */

const TITLES: Record<Tab, string> = {
  alliance: 'Alliance',
  games: 'Games',
  lobby: 'Lobby',
  data: 'Data',
  profile: 'My Account',
};

export function Header({ tab }: { tab: Tab }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{TITLES[tab]}</Text>

      {tab === 'lobby' && (
        <View style={styles.badge}>
          <Ionicons name="shield-checkmark" size={13} color={colors.success} />
          <Text style={styles.badgeText}>FAIR &amp; SECURE</Text>
        </View>
      )}
      {tab === 'alliance' && (
        <Ionicons name="help-circle-outline" size={18} color={colors.dim} />
      )}
      {tab === 'profile' && <Ionicons name="settings-outline" size={18} color={colors.dim} />}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: 'rgba(63,208,122,0.3)',
    backgroundColor: 'rgba(63,208,122,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: { color: colors.success, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
});
