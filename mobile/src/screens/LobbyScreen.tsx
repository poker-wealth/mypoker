import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { api } from '../api';
import type { RootStackParamList, TabParamList } from '../navigation';
import { money } from '../money';
import { radius, space, theme, weight } from '../theme';
import { Screen, Skeleton } from '../ui';
import { useContextStore } from '../store/context';
import { ContextBanner } from '../components/ContextBanner';

type TableStatus = 'UNAVAILABLE' | 'WAITING' | 'OPEN' | 'FULL';

interface LobbyTable {
  id: string;
  gameId: string;
  name: string;
  stakes: number | null;
  smallBlind?: number | null;
  players: number;
  maxPlayers: number;
  seatsFree: number;
  jackpot: number;
  buyInBB: number | null;
  status: TableStatus;
  youAreSeated?: boolean;
  waitingFor?: number;
}

interface GameSummary {
  gameId: string;
  name: string;
}

export function LobbyScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const tabNav = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const [game, setGame] = useState<string>('texas');
  
  const [blindFilter, setBlindFilter] = useState('ALL');
  const blindOptions = ['ALL', '1/2', '5/10', '25/50', '100/200'];

  const leagueId = useContextStore((s) => s.leagueId);

  const games = useQuery({
    queryKey: ['lobby', 'games'],
    queryFn: () => api.get<{ games: GameSummary[]; totalJackpot: number }>('/lobby/games'),
    staleTime: 30_000,
  });

  const tables = useQuery({
    queryKey: ['lobby', 'tables', game, leagueId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (game !== 'others') params.set('gameId', game);
      if (leagueId) params.set('leagueId', leagueId);
      const qs = params.toString();
      return api.get<{ tables: LobbyTable[] }>(`/lobby/tables${qs ? `?${qs}` : ''}`);
    },
    select: (data) => {
      if (game === 'others') {
        return { tables: data.tables.filter((t) => t.gameId !== 'texas' && t.gameId !== 'omaha') };
      }
      return data;
    },
    staleTime: 5_000,
    refetchInterval: 15_000,
  });

  // Filters from screenshot
  const filters = [
    { value: 'texas', label: 'DEZHOU' },
    { value: 'omaha', label: 'AUSHA' },
    { value: 'others', label: 'OTHERS' },
  ];

  const totalJackpot = games.data?.totalJackpot;

  return (
    <View style={styles.container}>
      <ContextBanner />
      
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Jackpot Hero */}
        <View style={styles.hero}>
          <LinearGradient
            colors={['#C9A15F', '#E8C98E', '#B38B4A']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Image source={require('../../assets/brand/trophy.png')} style={styles.trophy} resizeMode="contain" />
          <View style={styles.heroRight}>
            <Text style={styles.heroLabel}>GRAND JACKPOT</Text>
            {games.isPending ? (
              <Skeleton width={100} />
            ) : (
              <Text style={styles.heroValue}>
                {money(totalJackpot, { decimals: 0 })}
              </Text>
            )}
          </View>
        </View>

        {/* Game Filters */}
        <View style={styles.gameTabs}>
          {filters.map((f) => {
            const active = game === f.value;
            return (
              <Pressable
                key={f.value}
                onPress={() => setGame(f.value)}
                style={[styles.gameTab, active && styles.gameTabActive]}
              >
                <Text style={[styles.gameTabText, active && styles.gameTabTextActive]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Blind Filters */}
        <View style={styles.blindTabsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.blindTabs}>
            {blindOptions.map((opt) => (
              <Pressable
                key={opt}
                onPress={() => setBlindFilter(opt)}
                style={[styles.blindTab, blindFilter === opt && styles.blindTabActive]}
              >
                <Text style={[styles.blindTabText, blindFilter === opt && styles.blindTabTextActive]}>{opt}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable style={styles.filterBtn}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.dim} strokeWidth={2}>
              <Path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
            </Svg>
          </Pressable>
        </View>

        {/* Table List */}
        <Screen
          query={tables}
          empty={{
            when: (d) => d.tables.length === 0,
            title: t('lobby.noTables'),
          }}
          errorLabel={{ retry: t('common.retry'), fallback: t('states.error') }}
        >
          {(data) => (
            <View style={styles.tableList}>
              {/* Header Row */}
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.th, { flex: 1.5 }]}>TABLE</Text>
                <Text style={[styles.th, { flex: 1 }]}>BLINDS</Text>
                <Text style={[styles.th, { flex: 1.5, textAlign: 'center' }]}>PLAYERS</Text>
                <Text style={[styles.th, { flex: 1, textAlign: 'center' }]}>BUY-IN</Text>
                <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>STATUS</Text>
              </View>

              {/* Rows */}
              {data.tables.map((tbl, i) => (
                <Pressable
                  key={tbl.id}
                  style={[styles.tr, i > 0 && styles.trBorder]}
                  onPress={() => navigation.navigate('Table', { tableId: tbl.id })}
                >
                  <Text style={[styles.td, styles.tdName, { flex: 1.5 }]} numberOfLines={1}>{tbl.name || tbl.gameId}</Text>
                  
                  <Text style={[styles.td, { flex: 1 }]}>
                    {tbl.stakes === null ? '—' : `${tbl.smallBlind ?? tbl.stakes}/${tbl.stakes}`}
                  </Text>
                  
                  <View style={[styles.tdPlayers, { flex: 1.5 }]}>
                    <Text style={styles.tdPlayersVal}>{tbl.players}</Text>
                    <Text style={styles.tdPlayersMax}> / {tbl.maxPlayers}</Text>
                  </View>
                  
                  <Text style={[styles.td, { flex: 1, textAlign: 'center' }]}>
                    {tbl.buyInBB ? `${tbl.buyInBB} BB` : '—'}
                  </Text>
                  
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <View style={[styles.statusBtn, tbl.status !== 'OPEN' && tbl.status !== 'WAITING' && styles.statusBtnDisabled]}>
                      <Text style={styles.statusBtnText}>{tbl.status === 'WAITING' ? 'WAIT' : tbl.status}</Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </Screen>
      </ScrollView>

      {/* Floating Action Buttons */}
      <View style={styles.actionRow}>
        <Pressable
          style={styles.btnQuick}
          onPress={() => {
            if (!tables.data) return;
            const target = tables.data.tables.find((tb) => tb.status !== 'FULL' && tb.players < tb.maxPlayers) ?? tables.data.tables[0];
            if (target) navigation.navigate('Table', { tableId: target.id });
          }}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="white">
            <Path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </Svg>
          <Text style={styles.btnQuickText}>QUICK JOIN</Text>
        </Pressable>
        <Pressable
          style={styles.btnCreate}
          onPress={() => tabNav.navigate('Alliance')}
        >
          <Text style={styles.btnCreateIcon}>+</Text>
          <Text style={styles.btnCreateText}>CREATE PRIVATE TABLE</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  scrollContent: { padding: space.lg, gap: space.lg, paddingBottom: 100 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  headerTitle: { color: 'white', fontSize: 24, fontFamily: weight('900') },
  fairBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(63,208,122,0.3)',
  },
  fairBadgeText: { color: theme.success, fontSize: 10, fontFamily: weight('800') },
  
  hero: {
    height: 140,
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  trophy: {
    position: 'absolute',
    left: -20,
    bottom: -10,
    width: 180,
    height: 180,
  },
  heroRight: {
    flex: 1,
    alignItems: 'center',
    marginLeft: 100,
  },
  heroLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontFamily: weight('800'), letterSpacing: 0.5 },
  heroValue: { color: '#FFD700', fontSize: 38, fontFamily: weight('900'), textShadowColor: 'rgba(0,0,0,0.2)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 },
  
  gameTabs: { flexDirection: 'row', gap: space.sm },
  gameTab: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 2,
    borderRadius: 8,
    backgroundColor: theme.surface2,
  },
  gameTabActive: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.success,
  },
  gameTabText: { color: theme.dim, fontSize: 12, fontFamily: weight('800') },
  gameTabTextActive: { color: theme.success },

  blindTabsContainer: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  blindTabs: { gap: space.sm },
  blindTab: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: 8,
    backgroundColor: theme.surface2,
  },
  blindTabActive: { backgroundColor: theme.success },
  blindTabText: { color: theme.dim, fontSize: 13, fontFamily: weight('700') },
  blindTabTextActive: { color: 'white' },
  filterBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: theme.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  tableList: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderColor: theme.border,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 4,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  th: { color: theme.dim, fontSize: 10, fontFamily: weight('800'), letterSpacing: 0.5 },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  trBorder: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.03)' },
  td: { color: theme.dim, fontSize: 13, fontFamily: weight('500') },
  tdName: { color: theme.brand, fontFamily: weight('800') },
  tdPlayers: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' },
  tdPlayersVal: { color: 'white', fontSize: 14, fontFamily: weight('800') },
  tdPlayersMax: { color: theme.dim, fontSize: 12, fontFamily: weight('600') },
  
  statusBtn: {
    backgroundColor: 'rgba(63,208,122,0.15)',
    borderColor: theme.success,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  statusBtnDisabled: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
  },
  statusBtnText: { color: theme.success, fontSize: 11, fontFamily: weight('800') },

  actionRow: {
    position: 'absolute',
    bottom: 20,
    left: space.lg,
    right: space.lg,
    flexDirection: 'row',
    gap: space.md,
  },
  btnQuick: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: theme.success,
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnQuickText: { color: 'white', fontSize: 14, fontFamily: weight('800') },
  btnCreate: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: theme.surface2,
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnCreateIcon: { color: 'white', fontSize: 18, fontFamily: weight('400'), marginTop: -2 },
  btnCreateText: { color: 'white', fontSize: 12, fontFamily: weight('800') },
});
