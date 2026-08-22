import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { api } from '../api';
import type { RootStackParamList } from '../navigation';
import { money } from '../money';
import { radius, space, theme } from '../theme';
import { Skeleton } from '../ui';

/**
 * Lobby — the way into a table, laid out like the Mini App.
 *
 * This screen has been written twice and the second version is this one. The first was a native
 * list: correct, translated, and visibly a different product from the Mini App, which is the one
 * thing it could not be. Victor said so three times. The Mini App's lobby is the reference —
 * jackpot hero, variant tabs, stake pills, a five-column table grid, Quick Join — so that is what
 * this draws, from `frontend/src/pages/Lobby.tsx`.
 *
 * What came from the native version and is kept, because it was better:
 *   - every string through `t()`. A missing key renders raw, and the lobby is the first screen a
 *     player sees. The keys already existed (`lobby.*`) — nothing new to translate.
 *   - `refetchInterval`. A stale lobby sends people to tables that have since filled up.
 *   - an unreachable lobby says so. "No tables" when the request FAILED tells a player the platform
 *     is dead rather than that we could not ask.
 *
 * Honesty rules that travel with the design:
 *   - NO sample rows. The web lobby once invented six tables whenever the API returned nothing,
 *     which — with the gateway undeployed — was every time.
 *   - the hero shows an em dash, never "$0.00", until the pools are known. It is the one number
 *     here a player might act on.
 *   - buy-in and jackpot are the server's figures or nothing. The web version once printed
 *     `t.jackpot || t.stakes * 10`, advertising ten times the blind as a dollar amount.
 *   - every figure from the server is micro-USD and goes through `money()`. The raw field rendered
 *     a ₮52 pool as 52,000,000, in gold, as a prize.
 */

type TableStatus = 'UNAVAILABLE' | 'WAITING' | 'OPEN' | 'FULL';

interface LobbyTable {
  id: string;
  gameId: string;
  name: string;
  /** Stake level — big blind for poker, base bet elsewhere. Micro-USD. */
  stakes: number;
  players: number;
  maxPlayers: number;
  seatsFree: number;
  jackpot: number;
  buyInBB: number;
  status: TableStatus;
  waitingFor?: number;
}

interface LobbyGames {
  games: { gameId: string; name: string }[];
  /** Micro-USD. */
  totalJackpot: number;
}

/**
 * DEZHOU and AUSHA are single games and filter server-side. OTHERS means "every table that is not
 * one of those tabs" — a set the server has no filter parameter for, and sending `gameId: 'others'`
 * is a 400 by design. So OTHERS fetches unfiltered and excludes the named tabs' games here.
 */
const TAB_GAME: Record<string, string | undefined> = { dezhou: 'texas', ausha: 'omaha' };
const VARIANTS = ['dezhou', 'ausha', 'others'] as const;

const STAKES_OPTIONS: { id: string; label: string; minStakes?: number }[] = [
  { id: 'all', label: 'ALL' },
  { id: '1/2', label: '1/2', minStakes: 2_000_000 },
  { id: '5/10', label: '5/10', minStakes: 10_000_000 },
  { id: '25/50', label: '25/50', minStakes: 50_000_000 },
  { id: '100/200', label: '100/200', minStakes: 200_000_000 },
];

export function LobbyScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [variant, setVariant] = useState<string>('dezhou');
  const [blinds, setBlinds] = useState('all');
  const [onlyOpen, setOnlyOpen] = useState(false);

  const targetStakes = STAKES_OPTIONS.find((s) => s.id === blinds)?.minStakes;

  const games = useQuery({
    queryKey: ['lobby', 'games'],
    queryFn: () => api.get<LobbyGames>('/lobby/games'),
    staleTime: 30_000,
  });

  const tables = useQuery({
    queryKey: ['lobby', 'tables', variant, blinds, onlyOpen],
    queryFn: () => {
      const q = new URLSearchParams();
      const gameId = TAB_GAME[variant];
      if (gameId) q.set('gameId', gameId);
      if (targetStakes !== undefined) {
        q.set('minStakes', String(targetStakes));
        q.set('maxStakes', String(targetStakes));
      }
      if (onlyOpen) q.set('hasSeats', 'true');
      const s = q.toString();
      return api.get<{ tables: LobbyTable[] }>(`/lobby/tables${s ? `?${s}` : ''}`);
    },
    staleTime: 5_000,
    refetchInterval: 15_000,
  });

  const rows: LobbyTable[] =
    variant === 'others'
      ? (tables.data?.tables ?? []).filter((tb) => !Object.values(TAB_GAME).includes(tb.gameId))
      : (tables.data?.tables ?? []);

  // Undefined until the lobby answers — an em dash, never a zero.
  const totalJackpot = games.data?.totalJackpot;

  const open = (id: string): void => navigation.navigate('Table', { tableId: id });
  const enterable = (s: TableStatus): boolean => s === 'OPEN' || s === 'WAITING';

  const quickJoin = (): void => {
    const first = rows.find((r) => enterable(r.status));
    if (first) open(first.id);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/*
        The jackpot hero.

        The Mini App paints this with a CSS gradient and lays a trophy PNG over it. React Native has
        no CSS gradients, so the gradient is drawn with react-native-svg — already a dependency for
        the trend chart. The SVG is the MECHANISM, not a redesign: the stops below are exactly
        `--brand-gradient` from frontend/src/index.css, dark-theme values, since this app is
        dark-only. The trophy is the same asset, copied into the bundle.
      */}
      <View style={styles.hero}>
        <Svg style={StyleSheet.absoluteFill as never} width="100%" height="100%">
          <Defs>
            {/* linear-gradient(120deg, ...) — down and to the right. */}
            <LinearGradient id="heroGrad" x1="0" y1="0" x2="1" y2="0.6">
              <Stop offset="0" stopColor="#4f46e5" />
              <Stop offset="0.55" stopColor="#7c3aed" />
              <Stop offset="1" stopColor="#0891b2" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" rx="18" fill="url(#heroGrad)" />
        </Svg>

        <Image
          source={require('../../assets/brand/trophy.png')}
          resizeMode="contain"
          style={styles.heroTrophy}
        />

        <View style={styles.heroText}>
          <Text style={styles.heroLabel}>{t('lobby.grandJackpot').toUpperCase()}</Text>
          {games.isPending ? (
            <Skeleton width={190} />
          ) : (
            <Text style={styles.heroAmount}>
              {totalJackpot === undefined ? '—' : money(totalJackpot, { decimals: 0 })}
            </Text>
          )}
        </View>
      </View>

      {/* Variant tabs */}
      <View style={styles.variants}>
        {VARIANTS.map((v) => {
          const on = variant === v;
          return (
            <Pressable
              key={v}
              onPress={() => setVariant(v)}
              style={[styles.variant, on && styles.variantOn]}
            >
              <Text style={[styles.variantText, on && styles.variantTextOn]}>
                {t(`lobby.tab.${v}`).toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Stake pills, and the one filter a player in a lobby actually wants */}
      <View style={styles.stakesRow}>
        <View style={styles.stakes}>
          {STAKES_OPTIONS.map((s) => {
            const on = blinds === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => setBlinds(s.id)}
                style={[styles.stake, on && styles.stakeOn]}
              >
                <Text style={[styles.stakeText, on && styles.stakeTextOn]}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() => setOnlyOpen((v) => !v)}
          style={[styles.filter, onlyOpen && styles.filterOn]}
        >
          <Text style={[styles.filterText, onlyOpen && styles.filterTextOn]}>☰</Text>
        </Pressable>
      </View>

      {/* The grid */}
      <View style={styles.list}>
        <View style={styles.headRow}>
          <Text style={[styles.head, styles.colTable]}>{t('lobby.colTable').toUpperCase()}</Text>
          <Text style={[styles.head, styles.colBlinds]}>{t('lobby.colBlinds').toUpperCase()}</Text>
          <Text style={[styles.head, styles.colPlayers]}>{t('lobby.colPlayers').toUpperCase()}</Text>
          <Text style={[styles.head, styles.colBuyIn]}>{t('lobby.colBuyIn').toUpperCase()}</Text>
          <Text style={[styles.head, styles.colStatus]}>{t('lobby.colStatus').toUpperCase()}</Text>
        </View>

        {tables.isPending ? (
          [0, 1, 2].map((i) => (
            <View key={i} style={styles.row}>
              <Skeleton width={250} />
            </View>
          ))
        ) : tables.isError ? (
          <Text style={styles.stateText}>{t('states.serviceUnavailable')}</Text>
        ) : rows.length === 0 ? (
          <Text style={styles.stateText}>{t('lobby.noTables')}</Text>
        ) : (
          rows.map((tb) => {
            const full = tb.status === 'FULL' || tb.players >= tb.maxPlayers;
            return (
              <Pressable
                key={tb.id}
                onPress={() => enterable(tb.status) && open(tb.id)}
                style={styles.row}
              >
                <Text style={[styles.cellId, styles.colTable]} numberOfLines={1}>
                  {tb.id}
                </Text>
                <Text style={[styles.cellDim, styles.colBlinds]}>
                  {money(tb.stakes / 2, { symbol: false, decimals: 0 })}/
                  {money(tb.stakes, { symbol: false, decimals: 0 })}
                </Text>
                <Text style={[styles.cellStrong, styles.colPlayers]}>
                  {tb.players}/{tb.maxPlayers}
                </Text>
                <Text style={[styles.cellDim, styles.colBuyIn]}>{tb.buyInBB} BB</Text>
                <View style={styles.colStatus}>
                  {full ? (
                    <Text style={styles.badgeWait}>{t('lobby.status.full').toUpperCase()}</Text>
                  ) : tb.jackpot > 0 ? (
                    <Text style={styles.badgeOpen}>{money(tb.jackpot, { decimals: 0 })}</Text>
                  ) : (
                    // Open, with no pool to advertise. Say so rather than print a currency mark
                    // next to nothing.
                    <Text style={styles.badgeOpen}>{t('lobby.status.open').toUpperCase()}</Text>
                  )}
                </View>
              </Pressable>
            );
          })
        )}
      </View>

      <Pressable
        onPress={quickJoin}
        disabled={!rows.some((r) => enterable(r.status))}
        style={[styles.quickJoin, !rows.some((r) => enterable(r.status)) && styles.quickJoinOff]}
      >
        <Text style={styles.quickJoinText}>⚡ {t('lobby.quickJoin').toUpperCase()}</Text>
      </Pressable>
    </ScrollView>
  );
}

const GREEN = '#22c55e';
const GREEN_DEEP = '#0f3922';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: space.md, gap: 14, paddingBottom: space.xl },
  hero: {
    height: 128,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    overflow: 'hidden',
  },
  // The trophy sits at the left edge and overflows the hero's height, as it does on the web.
  // Explicit width AND height. 'top/bottom' with no height leaves an absolutely-positioned
  // Image with no intrinsic box on Android, and it renders nothing at all — silently.
  heroTrophy: { position: 'absolute', left: 8, top: 8, width: 104, height: 112 },
  // Offset right of the trophy so the figure is centred in the space that remains, not behind it.
  heroText: { alignItems: 'center', gap: 2, paddingLeft: 84 },
  heroLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  heroAmount: { color: '#facc15', fontSize: 35, fontWeight: '900' },
  variants: { flexDirection: 'row', gap: 6 },
  variant: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: theme.surface2,
  },
  variantOn: { backgroundColor: GREEN_DEEP, borderColor: GREEN },
  variantText: { color: theme.dim, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  variantTextOn: { color: GREEN },
  stakesRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  stakes: { flexDirection: 'row', gap: 6, flexShrink: 1, flexWrap: 'wrap' },
  stake: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: theme.surface2,
  },
  stakeOn: { backgroundColor: '#15803d' },
  stakeText: { color: theme.dim, fontSize: 12, fontWeight: '700' },
  stakeTextOn: { color: '#fff' },
  filter: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterOn: { borderColor: GREEN, backgroundColor: GREEN_DEEP },
  filterText: { color: theme.dim, fontSize: 13 },
  filterTextOn: { color: GREEN },
  list: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    overflow: 'hidden',
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  head: { color: theme.dim, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(44,44,72,0.4)',
    paddingHorizontal: space.md,
    paddingVertical: 12,
  },
  colTable: { flex: 2 },
  colBlinds: { flex: 1.5 },
  colPlayers: { flex: 1.3 },
  colBuyIn: { flex: 1.2 },
  colStatus: { flex: 1.5, alignItems: 'flex-end' },
  cellId: { color: '#eab308', fontSize: 12, fontWeight: '700' },
  cellDim: { color: theme.dim, fontSize: 12, fontWeight: '500' },
  cellStrong: { color: theme.text, fontSize: 12, fontWeight: '600' },
  badgeWait: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    color: theme.dim,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
  },
  badgeOpen: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.4)',
    backgroundColor: 'rgba(6,78,59,0.8)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    color: '#4ade80',
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
  },
  stateText: {
    padding: space.xl,
    textAlign: 'center',
    color: theme.dim,
    fontSize: 12,
    lineHeight: 18,
  },
  quickJoin: {
    borderRadius: radius.card,
    backgroundColor: '#16a34a',
    paddingVertical: 14,
    alignItems: 'center',
  },
  quickJoinOff: { opacity: 0.45 },
  quickJoinText: { color: '#fff', fontSize: 14, fontWeight: '900' },
});
