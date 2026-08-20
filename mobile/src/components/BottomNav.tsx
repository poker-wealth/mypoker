import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { useNav, type Tab } from '../navigation';

/**
 * The five product tabs, in the owner-specified order from the Mini App.
 *
 * Wallet is deliberately absent: it hangs off My Account as the deposit/withdraw entry point, which
 * is how the reference design has it. Lobby sits in the middle as home.
 *
 * Icons are @expo/vector-icons — Expo ships them, and lucide-react is a web-only package.
 */
const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'alliance', label: 'Alliance', icon: 'people-outline' },
  { key: 'games', label: 'Games', icon: 'game-controller-outline' },
  { key: 'lobby', label: 'Lobby', icon: 'home-outline' },
  { key: 'data', label: 'Data', icon: 'bar-chart-outline' },
  { key: 'profile', label: 'Account', icon: 'person-outline' },
];

export function BottomNav() {
  const { tab, goTab } = useNav();

  return (
    <View style={styles.nav}>
      {TABS.map(({ key, label, icon }) => {
        const active = tab === key;
        return (
          <Pressable key={key} onPress={() => goTab(key)} style={styles.tab}>
            <Ionicons name={icon} size={21} color={active ? colors.brand : colors.dim} />
            <Text style={[styles.label, { color: active ? colors.brand : colors.dim }]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 10 },
  label: { fontSize: 10, fontWeight: '600' },
});
