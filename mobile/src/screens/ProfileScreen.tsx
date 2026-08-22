import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { useAuth } from '../auth';
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
 * The identity header IS here now — avatar, name, VIP chip, player id, and the
 * settings gear. It was left out originally because there was "no reactive
 * session/player store, only a token": true when this was written, and untrue
 * since AuthProvider landed carrying the player. Every field is a server value.
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
  const { player } = useAuth();
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
          {/*
            Identity, and the settings gear.

            This header was left out of the original port with the note that there was "no reactive
            session/player store here, only a token". That was true then and is not now: Samuel's
            AuthProvider carries `player`, so the name, id, avatar and tier are all real values from
            the server rather than anything invented here. A signed-out viewer never reaches this
            screen — App.tsx renders LoginScreen instead — so there is no guest branch to write.
          */}
          <Pressable style={styles.identity} onPress={() => navigation.navigate('Settings')}>
            {player?.photoUrl ? (
              <Image source={{ uri: player.photoUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>
                  {(player?.displayName ?? 'M').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}

            <View style={styles.identityText}>
              <Text style={styles.displayName} numberOfLines={1}>
                {player?.displayName ?? t('account.guest')}
              </Text>
              <View style={styles.identityMeta}>
                {vip.isSuccess ? (
                  <View style={styles.vipChip}>
                    <Text style={styles.vipChipText}>♛ {vip.data.tier}</Text>
                  </View>
                ) : null}
                <Text style={styles.playerId} numberOfLines={1}>
                  {player ? t('account.id', { id: player.playerId }) : ''}
                </Text>
              </View>
            </View>

            <Text style={styles.chevron}>›</Text>
          </Pressable>

          {/* Tier progress sits directly under the identity, above the balance — the Mini App's
              order, and the one that reads correctly: it belongs to the person, not the money. */}
          <VipPreview vip={vip} onPress={() => navigation.navigate('Vip')} />

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
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: 4 },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarFallback: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.brand, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#fff', fontSize: 22, fontWeight: '900' },
  identityText: { flex: 1, minWidth: 0, gap: 5 },
  displayName: { color: theme.text, fontSize: 16, fontWeight: '700' },
  identityMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  vipChip: { backgroundColor: theme.brand, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  vipChipText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  playerId: { flex: 1, color: theme.dim, fontSize: 11 },
  chevron: { color: theme.dim, fontSize: 20 },
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
