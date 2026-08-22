import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '../api';
import type { RootStackParamList } from '../navigation';
import { money } from '../money';
import { space, theme } from '../theme';
import { Badge, Card, ListRow, Screen, Segmented } from '../ui';

/**
 * Lobby — the way into a table.
 *
 * This is the route the game side was missing: the felts exist and TableScreen
 * exists, but nothing navigated to them, so no table could be opened on a
 * device. The tab was a placeholder; it now lists what is running and pushes
 * `Table` with the id, which is the shell's half of that seam.
 *
 * It shows what the SERVER reports and nothing else — no sample rows, no
 * invented player counts, no placeholder jackpot. The web lobby carried all
 * three once and they had to be torn out.
 *
 * The filter bar sits OUTSIDE `Screen`, the same arrangement DataScreen uses
 * for its period bar. Inside, an empty result would replace the control that
 * caused it, stranding the player on a filter they can no longer change.
 */

type TableStatus = 'UNAVAILABLE' | 'WAITING' | 'OPEN' | 'FULL';

interface LobbyTable {
  id: string;
  gameId: string;
  name: string;
  /** Stake level — big blind for poker, base bet elsewhere. */
  stakes: number;
  players: number;
  maxPlayers: number;
  seatsFree: number;
  jackpot: number;
  buyInBB: number;
  status: TableStatus;
  /** Set only when the table cannot start: how many more players it needs. */
  waitingFor?: number;
}

interface GameSummary {
  gameId: string;
  name: string;
}

/** Tone follows the status the server reports; nothing is inferred here. */
const STATUS_TONE: Record<TableStatus, 'success' | 'accent' | 'neutral' | 'warn'> = {
  OPEN: 'success',
  WAITING: 'accent',
  FULL: 'neutral',
  UNAVAILABLE: 'warn',
};

/** Sitting is refused at the others, so those rows are not made to look tappable. */
const ENTERABLE: TableStatus[] = ['OPEN', 'WAITING'];

const ALL = '__all__';

export function LobbyScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [game, setGame] = useState<string>(ALL);

  const games = useQuery({
    queryKey: ['lobby', 'games'],
    queryFn: () => api.get<{ games: GameSummary[] }>('/lobby/games'),
    staleTime: 30_000,
  });

  const tables = useQuery({
    queryKey: ['lobby', 'tables', game],
    queryFn: () =>
      api.get<{ tables: LobbyTable[] }>(
        game === ALL ? '/lobby/tables' : `/lobby/tables?gameId=${encodeURIComponent(game)}`,
      ),
    // A stale lobby sends people to tables that have since filled up.
    staleTime: 5_000,
    refetchInterval: 15_000,
  });

  // Filters come from what the server actually serves, so a game with no tables
  // never appears as an option that returns nothing.
  const filters = [
    { value: ALL, label: t('games.filterAll') },
    ...(games.data?.games ?? []).map((g) => ({
      value: g.gameId,
      label: t(`gameNames.${g.gameId}`, { defaultValue: g.name }),
    })),
  ];

  return (
    <View style={styles.container}>
      {filters.length > 1 && (
        <View style={styles.filterBar}>
          <Segmented options={filters} value={game} onChange={setGame} />
        </View>
      )}

      <Screen
        query={tables}
        empty={{
          when: (d) => d.tables.length === 0,
          title: t('lobby.noTables'),
          body: t('lobby.noTablesBlurb'),
        }}
        errorLabel={{ retry: t('common.retry'), fallback: t('states.error') }}
      >
        {(data) => (
          <Card style={styles.listCard}>
            {data.tables.map((tbl) => (
              <TableRow
                key={tbl.id}
                table={tbl}
                onOpen={() => navigation.navigate('Table', { tableId: tbl.id })}
              />
            ))}
          </Card>
        )}
      </Screen>
    </View>
  );
}

function TableRow({ table, onOpen }: { table: LobbyTable; onOpen: () => void }) {
  const { t } = useTranslation();
  const name = table.name || t(`gameNames.${table.gameId}`, { defaultValue: table.gameId });

  // Seats first — it is what decides whether to tap — then the blinds as the
  // small/big pair, the way the web lobby prints them. `stakes` is micro-USD;
  // the raw field here rendered "Blinds 2000000" where "1/2" was meant — the
  // exact unit bug money() exists to prevent, caught in the task-8 audit.
  const blinds =
    `${money(table.stakes / 2, { symbol: false, decimals: 0 })}` +
    `/${money(table.stakes, { symbol: false, decimals: 0 })}`;
  const hint =
    `${t('lobby.colPlayers')} ${table.players}/${table.maxPlayers}` +
    ` · ${t('lobby.colBlinds')} ${blinds}`;

  return (
    <ListRow
      label={name}
      hint={hint}
      right={
        <View style={styles.right}>
          {/* Only a real jackpot is printed. A zero is not news, and a figure
              in this position reads as a prize on offer. */}
          {table.jackpot > 0 && (
            // Micro-USD, like every figure the lobby serves. The raw field
            // rendered a ₮52 pool as 52,000,000 — in gold, as a prize.
            <Text style={styles.jackpot}>{money(table.jackpot, { decimals: 0 })}</Text>
          )}
          <Badge tone={STATUS_TONE[table.status]}>
            {t(`lobby.status.${table.status.toLowerCase()}`, { defaultValue: table.status })}
          </Badge>
        </View>
      }
      {...(ENTERABLE.includes(table.status) ? { onPress: onOpen } : {})}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  filterBar: { paddingHorizontal: space.lg, paddingTop: space.lg },
  listCard: { padding: 0, paddingHorizontal: space.md, gap: 0 },
  right: { alignItems: 'flex-end', gap: space.xs },
  jackpot: {
    // The one place gold belongs: an actual jackpot figure.
    color: theme.jackpot,
    fontSize: 11,
    fontWeight: '800',
  },
});
