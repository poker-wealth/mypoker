import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { fetchLobbyGames, fetchTables, formatMicros, type TableView } from '../api/lobby';
import { Skeleton } from '../ui';
import { radius, space, theme } from '../theme';
import type { RootStackParamList } from '../navigation';

/**
 * The lobby.
 *
 * Ported from `frontend/src/pages/Lobby.tsx` — the same jackpot hero, the same variant tabs, the
 * same stakes pills and the same table list, so the app reads like the Mini App rather than like a
 * different product.
 *
 * The honesty rules come with it, and they are the point of most of this file:
 *
 *   - There is NO sample table list. Six invented tables used to render whenever the API returned
 *     nothing, which — with the gateway undeployed — was every time. A player saw a full lobby of
 *     tables that did not exist. An empty lobby is a fact; a fabricated one is a lie that also
 *     happens to be unjoinable.
 *   - An unreachable lobby is not an empty one. "No tables" when the request FAILED tells the
 *     player the platform is dead rather than that we could not ask.
 *   - The jackpot hero shows an em dash, never "$0.00", until the pools are known. It is the one
 *     number here a player might act on.
 *   - A table's buy-in and jackpot are the server's figures or nothing. The web version once
 *     printed `t.jackpot || t.stakes * 10`, advertising ten times the blind as a dollar amount on
 *     tables whose pool was empty.
 */

const VARIANTS = [
  { id: 'dezhou', label: 'DEZHOU' },
  { id: 'ausha', label: 'AUSHA' },
  { id: 'others', label: 'OTHERS' },
];

const STAKES_OPTIONS: { id: string; label: string; minStakes?: number }[] = [
  { id: 'all', label: 'ALL' },
  { id: '1/2', label: '1/2', minStakes: 2_000_000 },
  { id: '5/10', label: '5/10', minStakes: 10_000_000 },
  { id: '25/50', label: '25/50', minStakes: 50_000_000 },
  { id: '100/200', label: '100/200', minStakes: 200_000_000 },
];

/**
 * DEZHOU and AUSHA are single games and filter server-side. OTHERS means "every table that is not
 * one of those tabs" — a set the server has no filter parameter for, and sending
 * `gameId: 'others'` is a 400 by design. So OTHERS fetches unfiltered and excludes the named tabs'
 * games here.
 */
const TAB_GAME: Record<string, string | undefined> = { dezhou: 'texas', ausha: 'omaha' };

interface DisplayTable {
  id: string;
  blinds: string;
  players: string;
  buyIn: string;
  /** Pooled jackpot on this table, micro-USD. Null when the table has none. */
  jackpot: number | null;
  isFull: boolean;
}

export function LobbyScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [variant, setVariant] = useState('dezhou');
  const [blinds, setBlinds] = useState('all');
  const [onlyOpen, setOnlyOpen] = useState(false);

  const targetStakes = STAKES_OPTIONS.find((s) => s.id === blinds)?.minStakes;

  const lobby = useQuery({ queryKey: ['lobby', 'games'], queryFn: () => fetchLobbyGames() });
  const tables = useQuery({
    queryKey: ['lobby', 'tables', variant, blinds, onlyOpen],
    queryFn: () =>
      fetchTables({
        ...(TAB_GAME[variant] ? { gameId: TAB_GAME[variant] } : {}),
        ...(targetStakes === undefined ? {} : { minStakes: targetStakes, maxStakes: targetStakes }),
        // Stakes and seat filters stay server-side, so the count the lobby shows is the count the
        // server filtered.
        ...(onlyOpen ? { hasSeats: true } : {}),
      }),
  });

  const raw: TableView[] =
    variant === 'others'
      ? (tables.data?.tables ?? []).filter((t) => !Object.values(TAB_GAME).includes(t.gameId))
      : (tables.data?.tables ?? []);

  const displayTables: DisplayTable[] = raw.map((t) => ({
    id: t.id,
    blinds: `${formatMicros(t.stakes / 2, 0)}/${formatMicros(t.stakes, 0)}`,
    players: `${t.players} / ${t.maxPlayers}`,
    buyIn: `${t.buyInBB} BB`,
    jackpot: t.jackpot > 0 ? t.jackpot : null,
    isFull: t.status === 'FULL' || t.players >= t.maxPlayers,
  }));

  // Null while the lobby has not answered.
  const rawJackpot = lobby.data?.totalJackpot;
  const jackpotDisplay = rawJackpot === undefined ? null : `$ ${formatMicros(rawJackpot)}`;

  const open = (tableId: string): void => navigation.navigate('Table', { tableId });

  const quickJoin = (): void => {
    const available = displayTables.find((t) => !t.isFull) ?? displayTables[0];
    if (available) open(available.id);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* The jackpot hero */}
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>GRAND JACKPOT</Text>
        {lobby.isPending ? (
          <Skeleton width={200} />
        ) : (
          <Text style={styles.heroAmount}>{jackpotDisplay ?? '—'}</Text>
        )}
      </View>

      {/* Game type tabs */}
      <View style={styles.variants}>
        {VARIANTS.map((v) => {
          const active = variant === v.id;
          return (
            <Pressable
              key={v.id}
              onPress={() => setVariant(v.id)}
              style={[styles.variant, active && styles.variantOn]}
            >
              <Text style={[styles.variantText, active && styles.variantTextOn]}>{v.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Stakes pills, and the one filter a player in a lobby actually wants */}
      <View style={styles.stakesRow}>
        <View style={styles.stakes}>
          {STAKES_OPTIONS.map((s) => {
            const active = blinds === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => setBlinds(s.id)}
                style={[styles.stake, active && styles.stakeOn]}
              >
                <Text style={[styles.stakeText, active && styles.stakeTextOn]}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() => setOnlyOpen((v) => !v)}
          style={[styles.filter, onlyOpen && styles.filterOn]}
        >
          <Text style={[styles.filterText, onlyOpen && styles.filterTextOn]}>≡</Text>
        </Pressable>
      </View>

      {/* The table list */}
      <View style={styles.list}>
        <View style={styles.headRow}>
          <Text style={[styles.head, styles.colTable]}>TABLE</Text>
          <Text style={[styles.head, styles.colBlinds]}>BLINDS</Text>
          <Text style={[styles.head, styles.colPlayers]}>PLAYERS</Text>
          <Text style={[styles.head, styles.colBuyIn]}>BUY-IN</Text>
          <Text style={[styles.head, styles.colStatus]}>STATUS</Text>
        </View>

        {tables.isPending ? (
          [0, 1, 2].map((i) => (
            <View key={i} style={styles.row}>
              <Skeleton width={260} />
            </View>
          ))
        ) : tables.isError ? (
          <Text style={styles.stateText}>
            The lobby could not be reached. This is not an empty lobby — we could not ask.
          </Text>
        ) : displayTables.length === 0 ? (
          <Text style={styles.stateText}>No tables match these filters.</Text>
        ) : (
          displayTables.map((t) => (
            <Pressable key={t.id} onPress={() => open(t.id)} style={styles.row}>
              <Text style={[styles.cellId, styles.colTable]} numberOfLines={1}>
                {t.id}
              </Text>
              <Text style={[styles.cellDim, styles.colBlinds]}>{t.blinds}</Text>
              <Text style={[styles.cellStrong, styles.colPlayers]}>{t.players}</Text>
              <Text style={[styles.cellDim, styles.colBuyIn]}>{t.buyIn}</Text>
              <View style={styles.colStatus}>
                {t.isFull ? (
                  <Text style={styles.badgeWait}>WAIT</Text>
                ) : t.jackpot !== null ? (
                  <Text style={styles.badgeOpen}>${formatMicros(t.jackpot, 0)}</Text>
                ) : (
                  // Open, but with no pool to advertise. Say the table is open rather than print a
                  // dollar sign next to nothing.
                  <Text style={styles.badgeOpen}>OPEN</Text>
                )}
              </View>
            </Pressable>
          ))
        )}
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={quickJoin}
          disabled={displayTables.length === 0}
          style={[styles.quickJoin, displayTables.length === 0 && styles.quickJoinOff]}
        >
          <Text style={styles.quickJoinText}>⚡ QUICK JOIN</Text>
        </Pressable>
      </View>
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
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.brand,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
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
  stake: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: theme.surface2 },
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
  filterText: { color: theme.dim, fontSize: 14 },
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
  head: { color: theme.dim, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(44,44,72,0.4)',
    paddingHorizontal: space.md,
    paddingVertical: 12,
  },
  colTable: { flex: 2.2 },
  colBlinds: { flex: 1.4 },
  colPlayers: { flex: 1.3 },
  colBuyIn: { flex: 1.2 },
  colStatus: { flex: 1.4, alignItems: 'flex-end' },
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
  actions: { flexDirection: 'row', gap: space.md, paddingTop: space.sm },
  quickJoin: {
    flex: 1,
    borderRadius: radius.card,
    backgroundColor: '#16a34a',
    paddingVertical: 14,
    alignItems: 'center',
  },
  quickJoinOff: { opacity: 0.45 },
  quickJoinText: { color: '#fff', fontSize: 14, fontWeight: '900' },
});
