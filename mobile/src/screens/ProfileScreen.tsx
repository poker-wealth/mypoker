import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import type { RootStackParamList } from '../navigation';
import { moneyFromDecimal } from '../money';
import { radius, space, theme } from '../theme';
import { Badge, Card, ListRow, Screen, Skeleton } from '../ui';

/**
 * Profile — the account hub. Ported from frontend/src/pages/Profile.tsx, and
 * replaces AccountScreen, which its own comment called "a minimal stand-in"
 * for exactly this screen.
 *
 * Left out, deliberately, because what they depend on does not exist in the
 * shell yet:
 *
 *   Identity (avatar, display name, sign-in card, sign-out) — there is no
 *   reactive session/player store here, only a token (see session.ts). Every
 *   other ported screen (Vip, Settings, Wallet) handles that the same way:
 *   no gate, just ask the server and let a 401 speak for itself. This screen
 *   follows suit rather than inventing a player identity to show.
 *
 *   Personal Info, Fairness, Invite Friends, Support, Language — each is its
 *   own unported screen or unavailable config (no SUPPORT_URL, no language
 *   picker; i18n.ts reads the device language once and says switching
 *   "belongs with Settings, not here"). Rows for pages that do not exist
 *   would be dead taps.
 *
 *   Deposit / Withdraw buttons — WalletScreen has no deposit or withdraw flow
 *   yet, only a balance read. A button wired to nothing is worse than no
 *   button.
 *
 * What is left is exactly what can be shown honestly: the real balance, the
 * real VIP progress (same endpoint and cache key as VipScreen, so the two
 * screens can never disagree), and the same menu AccountScreen had.
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
            {/* Wallet is reached from here, not from a tab — the Mini App's own arrangement.

                The Mini App's balance card also carries Deposit and Withdraw. Those are NOT
                reproduced here because neither flow exists on mobile yet: WalletScreen shows a
                balance and nothing else. A Deposit button opening a screen with no way to deposit
                is exactly the dead control this project keeps removing. It goes in when the flow
                does. */}
            <ListRow label={t('wallet.detail')} onPress={() => navigation.navigate('Wallet')} />
            <ListRow
              label={t('account.vipMembership')}
              hint={t('account.checkPrivileges')}
              onPress={() => navigation.navigate('Vip')}
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
              label={t('agent.title')}
              onPress={() => navigation.navigate('AgentCenter')}
            />
            <ListRow label={t('account.settings')} onPress={() => navigation.navigate('Settings')} />
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
  balanceLabel: { color: theme.dim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  balanceToggle: { color: theme.dim, fontSize: 11, fontWeight: '700' },
  balanceAmount: { marginTop: space.xs, color: theme.text, fontSize: 30, fontWeight: '900' },
  balanceSplit: { marginTop: 2, color: theme.dim, fontSize: 11 },
  vipCard: { padding: space.md },
  vipRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  vipTitle: { flexShrink: 0, color: theme.text, fontSize: 12, fontWeight: '700' },
  vipBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: theme.surface2,
    overflow: 'hidden',
  },
  vipBarFill: { height: '100%', borderRadius: radius.pill, backgroundColor: theme.brand },
  vipPct: { flexShrink: 0, color: theme.dim, fontSize: 11 },
  menuCard: { padding: 0, paddingHorizontal: space.md, gap: 0 },
  buildLine: { paddingTop: space.xs, color: theme.dim, fontSize: 10, textAlign: 'center' },
});
