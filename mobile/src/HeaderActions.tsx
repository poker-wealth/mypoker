import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from './api';
import type { RootStackParamList } from './navigation';
import { radius, space, theme, weight } from './theme';
import { BellIcon, GearIcon, HelpIcon, ShieldIcon } from './icons';

/**
 * The tab headers' right-hand actions, mirroring `frontend/src/components/Header.tsx`.
 *
 * The web puts these in its own sticky header; React Navigation gives each
 * screen a `headerRight`, which is the native equivalent and why there is no
 * Header component here. What matters for parity is that the same affordance
 * appears on the same screen.
 *
 * Per the web, exactly:
 *
 *   Alliance  a help glyph (inert there too — it is an affordance, not a link)
 *   Games     nothing
 *   Lobby     the "fair & secure" badge
 *   Data      a settings gear
 *   Account   a settings gear
 *
 * The bell sits to the LEFT of all of them and, as on the web, appears ONLY
 * when there is something unread. A permanently visible bell with no badge is
 * a button that usually does nothing; the web hides it and so does this.
 */

/**
 * Matches the web's `useUnreadCount`, and deliberately uses the SAME query key
 * and request as ProfileScreen — there is no /unread endpoint, the count rides
 * on the notifications list. Same key means one fetch feeding both, and no
 * chance of the header and the Account row disagreeing about the number.
 */
function useUnread(): number {
  const q = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unread: number }>('/me/notifications?limit=1').then((p) => p.unread),
    staleTime: 30_000,
    retry: 1,
  });
  return q.data ?? 0;
}

function Bell() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const unread = useUnread();

  if (unread <= 0) return null;

  return (
    <Pressable
      onPress={() => navigation.navigate('Notifications')}
      accessibilityRole="button"
      accessibilityLabel={t('notifications.title')}
      style={styles.iconButton}
    >
      <BellIcon color={theme.dim} size={18} />
      <View style={styles.badge}>
        {/* 9+ rather than a wide number: the web caps it the same way, and a
            three-digit badge overruns the icon. */}
        <Text style={styles.badgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
      </View>
    </Pressable>
  );
}

function SettingsButton() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Pressable
      onPress={() => navigation.navigate('Settings')}
      accessibilityRole="button"
      accessibilityLabel={t('account.settings')}
      style={styles.iconButton}
    >
      <GearIcon color={theme.dim} size={18} />
    </Pressable>
  );
}

function FairSecureBadge() {
  const { t } = useTranslation();
  return (
    <View style={styles.fairBadge}>
      <ShieldIcon color={theme.success} size={13} />
      <Text style={styles.fairText}>{t('lobby.fairSecure')}</Text>
    </View>
  );
}

/** `headerRight` for each tab. Anything not listed gets the bell alone. */
export const headerRightFor = (screen: 'Alliance' | 'Games' | 'Tables' | 'Data' | 'Account') =>
  function HeaderRight() {
    return (
      <View style={styles.row}>
        <Bell />
        {screen === 'Alliance' && <HelpIcon color={theme.dim} size={18} />}
        {screen === 'Tables' && <FairSecureBadge />}
        {(screen === 'Data' || screen === 'Account') && <SettingsButton />}
      </View>
    );
  };

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingRight: space.md },
  iconButton: { alignItems: 'center', justifyContent: 'center', width: 32, height: 32 },
  badge: {
    position: 'absolute',
    right: 0,
    top: 0,
    minWidth: 16,
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: theme.danger,
    paddingHorizontal: 4,
  },
  badgeText: { color: '#ffffff', fontSize: 9, fontFamily: weight('700') },
  fairBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(63,208,122,0.3)',
    backgroundColor: 'rgba(63,208,122,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  fairText: {
    color: theme.success,
    fontSize: 10,
    textTransform: 'uppercase',
    fontFamily: weight('700'),
  },
});
