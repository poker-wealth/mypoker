import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { useAuth } from '../auth';
import type { RootStackParamList } from '../navigation';
import { moneyFromDecimal } from '../money';
import { radius, space, theme, weight } from '../theme';
import { Badge, Card, ListRow, Screen, Skeleton } from '../ui';

/**
 * Profile — the account hub. Ported from frontend/src/pages/Profile.tsx, and
 * replaces AccountScreen, which its own comment called "a minimal stand-in"
 * for exactly this screen.
 *
 * The menu mirrors the web's Menu component (frontend/src/pages/Profile.tsx
 * ~308-380) — same order, same t() keys: Wallet · VIP · Fairness · Invite
 * Friends · Message Center · Settings · Sign Out. Three of the web's rows are
 * deliberately not here:
 *
 *   Identity (avatar, display name, sign-in card) — there is no reactive
 *   session/player store here, only a token (see session.ts). Every other
 *   ported screen (Vip, Settings, Wallet) handles that the same way: no gate,
 *   just ask the server and let a 401 speak for itself.
 *
 *   Personal Info — on the web this row navigates to the same /settings
 *   destination as its own "Settings" row further down the same menu; adding
 *   it here would just be a second row to the screen already one tap away.
 *
 *   Support — the web's row opens SUPPORT_URL (frontend/src/config.ts), built
 *   from VITE_SUPPORT_URL / VITE_TELEGRAM_BOT_NAME. Neither exists on the
 *   mobile side (no config.ts, no env plumbing), so there is no URL to open
 *   and no toast-only row worth adding either — a row that always shows
 *   "connecting" is a dead tap on every locale.
 *
 *   Language — i18n.ts reads the device language once at startup; there is no
 *   picker to route to.
 *
 * Sign Out is here now too (it was Settings-only before) — the web has it in
 * both places, via the same useAuth().signOut() Settings already calls.
 *
 * What is left is exactly what can be shown honestly: the real balance, the
 * real VIP progress (same endpoint and cache key as VipScreen, so the two
 * screens can never disagree), and a menu matching the web's own admission of
 * what does not exist yet.
 */

interface Balance {
  available: string;
  locked: string;
  total: string;
}

type VipTier = 'V1' | 'V2' | 'V3' | 'V4' | 'V5';

interface VipPreviewData {
  tier: VipTier;
  progressPct: number;
  next: { tier: VipTier } | null;
}

export function ProfileScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signOut } = useAuth();
  const [hidden, setHidden] = useState(false);

  const balance = useQuery({
    queryKey: ['wallet', 'balance'],
    queryFn: () => api.get<Balance>('/me/balance'),
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1,
  });

  // Same key as VipScreen's query — one fetch, one cache, so the preview here
  // and the full page can never show two different tiers.
  const vip = useQuery({
    queryKey: ['vip'],
    queryFn: () => api.get<VipPreviewData>('/me/vip'),
    staleTime: 60_000,
    retry: 1,
  });

  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unread: number }>('/me/notifications?limit=1').then((p) => p.unread),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  return (
    <Screen query={balance} errorLabel={{ retry: t('common.retry'), fallback: t('states.error') }}>
      {(data) => (
        <>
          <Card>
            <View style={styles.balanceHeader}>
              <Text style={styles.balanceLabel}>{t('wallet.totalBalance')}</Text>
              <Pressable onPress={() => setHidden((v) => !v)} hitSlop={8}>
                <Text style={styles.balanceToggle}>
                  {hidden ? t('wallet.showBalance') : t('wallet.hideBalance')}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.balanceAmount} numberOfLines={1}>
              {hidden ? '••••••' : moneyFromDecimal(data.total)}
            </Text>

            {!hidden && (
              <Text style={styles.balanceSplit}>
                {t('wallet.availableSplit', {
                  available: moneyFromDecimal(data.available),
                  locked: moneyFromDecimal(data.locked),
                })}
              </Text>
            )}
          </Card>

          <VipPreview vip={vip} onPress={() => navigation.navigate('Vip')} />

          <Card style={styles.menuCard}>
            {/* Wallet lives here, not in the tab bar — the web reaches it from
                this menu (frontend/src/pages/Profile.tsx) and the tab was an
                artefact of it being the shell's first bring-up screen. */}
            <ListRow
              label={t('account.wallet')}
              onPress={() => navigation.navigate('Wallet')}
            />
            <ListRow
              label={t('account.vipMembership')}
              hint={t('account.checkPrivileges')}
              onPress={() => navigation.navigate('Vip')}
            />
            <ListRow
              label={t('account.fairness')}
              onPress={() => navigation.navigate('Fairness')}
            />
            {/* Web's "Invite Friends" row, same keys and same destination
                (AgentCenter) — was t('agent.title') here, which is a
                different string in all eight locales for the same screen. */}
            <ListRow
              label={t('account.inviteFriends')}
              hint={t('account.earnRewards')}
              onPress={() => navigation.navigate('AgentCenter')}
            />
            <ListRow
              label={t('account.messageCenter')}
              onPress={() => navigation.navigate('Notifications')}
              right={
                unread.isSuccess && unread.data > 0 ? (
                  <Badge tone="warn">{unread.data > 99 ? '99+' : unread.data}</Badge>
                ) : undefined
              }
            />
            <ListRow
              label={t('account.personalInfo')}
              onPress={() => navigation.navigate('PersonalInfo')}
            />
            <ListRow label={t('account.settings')} onPress={() => navigation.navigate('Settings')} />
            <ListRow label={t('account.signOut')} onPress={() => void signOut()} />
          </Card>

          <Text style={styles.buildLine}>{t('account.buildLine')}</Text>
        </>
      )}
    </Screen>
  );
}

/**
 * The VIP progress preview. A quiet secondary widget, not the page's main
 * fetch — a skeleton while loading and nothing at all on failure, same as the
 * web original: a broken preview should not block the rest of the profile,
 * and the full picture (with a retry) is one tap away on VipScreen.
 */
function VipPreview({
  vip,
  onPress,
}: {
  vip: { data?: VipPreviewData; isPending: boolean; isSuccess: boolean };
  onPress: () => void;
}) {
  const { t } = useTranslation();

  if (vip.isPending) {
    return (
      <Card>
        <Skeleton width={220} />
      </Card>
    );
  }
  if (!vip.isSuccess || !vip.data) return null;

  const { tier, progressPct, next } = vip.data;

  return (
    <Pressable onPress={onPress}>
      <Card style={styles.vipCard}>
        <View style={styles.vipRow}>
          <Text style={styles.vipTitle}>{t(`vip.title.${tier}`)}</Text>
          <View style={styles.vipBarTrack}>
            <View style={[styles.vipBarFill, { width: `${next ? progressPct : 100}%` }]} />
          </View>
          <Text style={styles.vipPct}>{next ? `${progressPct}%` : t('vip.topTier')}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  balanceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  balanceLabel: { color: theme.dim, fontSize: 11, textTransform: 'uppercase', fontFamily: weight('700') },
  balanceToggle: { color: theme.dim, fontSize: 11, fontFamily: weight('700') },
  balanceAmount: { marginTop: space.xs, color: theme.text, fontSize: 30, fontFamily: weight('900') },
  balanceSplit: { marginTop: 2, color: theme.dim, fontSize: 11, fontFamily: weight('400') },
  vipCard: { padding: space.md },
  vipRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  vipTitle: { flexShrink: 0, color: theme.text, fontSize: 12, fontFamily: weight('700') },
  vipBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: theme.surface2,
    overflow: 'hidden',
  },
  vipBarFill: { height: '100%', borderRadius: radius.pill, backgroundColor: theme.brand },
  vipPct: { flexShrink: 0, color: theme.dim, fontSize: 11, fontFamily: weight('400') },
  menuCard: { padding: 0, paddingHorizontal: space.md, gap: 0 },
  buildLine: { paddingTop: space.xs, color: theme.dim, fontSize: 10, textAlign: 'center', fontFamily: weight('400') },
});
