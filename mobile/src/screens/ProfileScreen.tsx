import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { Avatar } from '../components/ui/Avatar';
import { useAuth } from '../auth';
import { DataIcon, EditIcon, GearIcon, InviteIcon, ShieldIcon, TrophyIcon } from '../icons';
import type { IconProps } from '../icons';
import type { RootStackParamList } from '../navigation';
import { moneyFromDecimal } from '../money';
import { radius, space, theme, weight } from '../theme';
import { Card, Screen, Skeleton } from '../ui';

/**
 * Me — the account hub, laid out after the reference's 我的 screen.
 *
 * Three blocks, in its order: a membership card, a wallet row, and a grid of
 * icon tiles. That replaces the flat list of ListRows this screen used to be;
 * the destinations are mostly the same, reached in one tap rather than read as
 * a menu.
 *
 * ── What the reference has that we do not, and why it is absent ────────────
 *
 * Its grid is ten tiles and its wallet row counts three currencies. Six of the
 * ten have nothing behind them here, so they are not drawn:
 *
 *   Items            no inventory exists — not an endpoint, not a model
 *   My friends       no friends system
 *   Feedback         no endpoint (the web has SUPPORT_URL; mobile has no config)
 *   Guardian Star    no such concept anywhere in the repo
 *   Theme            FeltGalleryScreen is registered under `__DEV__` only
 *                    (App.tsx ~369), so in a release build the route is absent
 *   Hands Histories  `/me/history` is already inside DataScreen next to the
 *                    stats — one screen, so one tile, not two
 *
 * The owner chose this over drawing all ten with dead taps. A tile that opens
 * nothing is TRAPS §12 — the affordance claims a thing exists and it does not —
 * and on a gambling app that reads as broken rather than as unfinished.
 *
 * THE THREE CURRENCIES ARE ONE. The reference counts diamonds, gold coins and
 * green coins; `/me/balance` returns a single balance. Three icons sitting at
 * zero would render an economy we do not have, which mobile/CLAUDE.md forbids.
 * The row keeps the reference's shape and shows the number we actually hold.
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

/**
 * The card's colour IS the tier — which is what the reference is doing, since
 * its card reads "Blue Card" because blue is the tier's name. Ours are named
 * already (vip.title.V1…V5: Wanderer, Rising Star, Gold, Platinum, Black
 * Gold), so the colour follows the name instead of being decoration.
 */
const TIER_CARD: Record<VipTier, string> = {
  V1: '#1d4ed8',
  V2: '#0f766e',
  V3: '#9a6a12',
  V4: '#4a5568',
  V5: '#1c1917',
};

/** Grouped for reading, the way the reference prints it: 109 485 676 68. */
function groupId(id: string): string {
  if (!/^\d+$/.test(id)) return id;
  return (id.match(/\d{1,3}/g) ?? [id]).join(' ');
}

export function ProfileScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signOut, player } = useAuth();

  const balance = useQuery({
    queryKey: ['wallet', 'balance'],
    queryFn: () => api.get<Balance>('/me/balance'),
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1,
  });

  // Same key as VipScreen's query — one fetch, one cache, so the card here and
  // the full page can never show two different tiers.
  const vip = useQuery({
    queryKey: ['vip'],
    queryFn: () => api.get<VipPreviewData>('/me/vip'),
    staleTime: 60_000,
    retry: 1,
  });

  const settings = useQuery({
    queryKey: ['me', 'settings'],
    queryFn: () => api.get<{ avatarId: string | null }>('/me/settings'),
    staleTime: 30_000,
  });

  const tiles: {
    key: string;
    label: string;
    Icon: (p: IconProps) => React.JSX.Element;
    go: () => void;
  }[] = [
    {
      key: 'results',
      label: t('account.results'),
      Icon: DataIcon,
      // Nested navigate — Data is a tab, not a root route. See navigation.ts.
      go: () => navigation.navigate('Tabs', { screen: 'Data' }),
    },
    {
      key: 'invite',
      label: t('account.inviteFriends'),
      Icon: InviteIcon,
      go: () => navigation.navigate('AgentCenter'),
    },
    {
      key: 'jackpot',
      label: t('account.jackpot'),
      Icon: TrophyIcon,
      go: () => navigation.navigate('Jackpot'),
    },
    {
      key: 'alias',
      label: t('account.personalInfo'),
      Icon: EditIcon,
      go: () => navigation.navigate('PersonalInfo'),
    },
    {
      key: 'fairness',
      label: t('account.fairness'),
      Icon: ShieldIcon,
      go: () => navigation.navigate('Fairness'),
    },
    {
      key: 'settings',
      label: t('account.settings'),
      Icon: GearIcon,
      go: () => navigation.navigate('Settings'),
    },
  ];

  return (
    <Screen query={balance} errorLabel={{ retry: t('common.retry'), fallback: t('states.error') }}>
      {(data) => (
        <>
          <TierCard
            vip={vip}
            name={player ? player.displayName : t('account.guest')}
            playerId={player?.playerId}
            photoUrl={player?.photoUrl}
            avatarId={settings.data?.avatarId}
            onPress={() => navigation.navigate('Vip')}
          />

          {/* The reference's Store row. Ours opens the wallet and carries the
              one balance we actually have — see the note at the top. */}
          <Pressable onPress={() => navigation.navigate('Wallet')} accessibilityRole="button">
            <Card style={styles.walletRow}>
              <Text style={styles.walletLabel}>{t('account.wallet')}</Text>
              <View style={styles.walletRight}>
                <Text style={styles.walletAmount} numberOfLines={1}>
                  {moneyFromDecimal(data.total)}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </View>
            </Card>
          </Pressable>

          <Card style={styles.gridCard}>
            <View style={styles.grid}>
              {tiles.map(({ key, label, Icon, go }) => (
                <Pressable
                  key={key}
                  style={styles.tile}
                  onPress={go}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                >
                  <Icon color={theme.brand} size={26} />
                  <Text style={styles.tileLabel} numberOfLines={2}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Card>

          <Pressable onPress={() => void signOut()} accessibilityRole="button">
            <Card style={styles.signOutCard}>
              <Text style={styles.signOut}>{t('account.signOut')}</Text>
            </Card>
          </Pressable>

          <Text style={styles.buildLine}>{t('account.buildLine')}</Text>
        </>
      )}
    </Screen>
  );
}

/**
 * The membership card.
 *
 * The VIP half is a secondary fetch, so it degrades on its own: a skeleton
 * while it loads, and simply nothing where the tier would be if it fails. The
 * card still shows who you are — a broken VIP query should not take the
 * avatar, the name and the ID down with it, and VipScreen holds the retry.
 */
function TierCard({
  vip,
  name,
  playerId,
  photoUrl,
  avatarId,
  onPress,
}: {
  vip: { data?: VipPreviewData; isPending: boolean; isSuccess: boolean };
  name: string;
  playerId?: string;
  photoUrl?: string | null;
  avatarId?: string | null;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const tier = vip.isSuccess ? vip.data?.tier : undefined;

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <View style={[styles.tierCard, { backgroundColor: tier ? TIER_CARD[tier] : theme.surface2 }]}>
        <View style={styles.tierTop}>
          <Avatar
            avatarId={avatarId}
            playerId={playerId}
            photoUrl={photoUrl}
            // 'M' for the brand, not the translated "Guest" word's initial —
            // matches the web's own untranslated MYPOKER fallback.
            name={name || 'M'}
            size={52}
          />
          <View style={styles.tierWho}>
            <View style={styles.tierNameRow}>
              <Text style={styles.tierName} numberOfLines={1}>
                {name}
              </Text>
              {tier ? (
                <View style={styles.vipPill}>
                  <Text style={styles.vipPillText}>{t('account.vip', { tier })}</Text>
                </View>
              ) : null}
            </View>
            {vip.isPending ? <Skeleton width={160} /> : null}
            {tier && vip.data ? <TierProgress vip={vip.data} /> : null}
          </View>
          {tier ? (
            <Text style={styles.tierLabel} numberOfLines={1}>
              {t(`vip.title.${tier}`)}
            </Text>
          ) : null}
        </View>

        {playerId ? (
          <Text style={styles.tierId} numberOfLines={1}>
            {t('account.id', { id: groupId(playerId) })}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** The reference's V0 ──── V1 rail, with our own tiers in it. */
function TierProgress({ vip }: { vip: VipPreviewData }) {
  const { t } = useTranslation();
  const { tier, progressPct, next } = vip;

  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressLabels}>
        <Text style={styles.progressFrom}>{tier}</Text>
        <Text style={styles.progressTo}>{next ? next.tier : t('vip.topTier')}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${next ? progressPct : 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tierCard: { borderRadius: radius.card, padding: space.lg, gap: space.lg, minHeight: 150 },
  tierTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  tierWho: { flex: 1, minWidth: 0, gap: space.xs },
  tierNameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tierName: { flexShrink: 1, color: '#fff', fontSize: 16, fontFamily: weight('800') },
  vipPill: {
    flexShrink: 0,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  vipPillText: { color: '#fff', fontSize: 10, fontFamily: weight('800') },
  tierLabel: { flexShrink: 0, color: '#fff', fontSize: 15, fontFamily: weight('800') },
  progressWrap: { gap: 3, marginTop: 2 },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  progressFrom: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontFamily: weight('700') },
  progressTo: { color: theme.brand, fontSize: 11, fontFamily: weight('700') },
  progressTrack: {
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.28)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  tierId: { color: '#fff', fontSize: 22, letterSpacing: 1.5, fontFamily: weight('800') },

  walletRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  walletLabel: { color: theme.text, fontSize: 15, fontFamily: weight('700') },
  walletRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: 0 },
  walletAmount: { flexShrink: 1, color: theme.jackpot, fontSize: 15, fontFamily: weight('800') },
  chevron: { color: theme.dim, fontSize: 20, fontFamily: weight('400') },

  gridCard: { paddingVertical: space.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { width: '33.333%', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  tileLabel: { color: theme.text, fontSize: 12, textAlign: 'center', fontFamily: weight('600') },

  signOutCard: { alignItems: 'center' },
  signOut: { color: theme.danger, fontSize: 15, fontFamily: weight('700') },
  buildLine: {
    paddingTop: space.xs,
    color: theme.dim,
    fontSize: 10,
    textAlign: 'center',
    fontFamily: weight('400'),
  },
});
