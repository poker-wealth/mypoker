import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { api } from '../api';
import type { RootStackParamList, TabParamList } from '../navigation';
import { money } from '../money';
import { space, theme, weight } from '../theme';
import { Badge, Button, Card, ListRow, Screen, Segmented, Skeleton, Toggle } from '../ui';

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
 *
 * Ported for parity against `frontend/src/pages/Lobby.tsx`:
 *  - the "only tables with a free seat" toggle (hasSeats server-side filter)
 *  - the Grand Jackpot figure (from /lobby/games' totalJackpot, micro-USD)
 *  - the two status words the web actually uses (lobby.open / lobby.wait)
 *  - a Create Private Table control — a signpost to the Alliance tab, not a
 *    form (see the comment at its call site below)
 *  - Quick Join — first table with a free seat, else the first table listed
 */

type TableStatus = 'UNAVAILABLE' | 'WAITING' | 'OPEN' | 'FULL';

interface LobbyTable {
  id: string;
  gameId: string;
  name: string;
  /**
   * Stake level in table chips — the big blind for poker, a fixed base stake
   * for a game that has one, or NULL for a game with neither.
   *
   * Nullable because most games here have no table-level stake at all: each
   * player picks their own bet per round. They used to report 0, which this
   * screen rendered as "Blinds 0/0" on nine of thirteen tables.
   */
  stakes: number | null;
  /** The small blind, sent by the server rather than derived as `stakes / 2`. */
  smallBlind?: number | null;
  players: number;
  maxPlayers: number;
  seatsFree: number;
  jackpot: number;
  buyInBB: number | null;
  status: TableStatus;
  /**
   * True for the table THIS player is seated at. Per-viewer, sent by the
   * gateway only when the request carried a token.
   *
   * The server enforces one account, one table, so a player who sits down and
   * navigates away is refused everywhere else until they stand. Nothing used
   * to say which table held the seat, and with thirteen of them the only way
   * back was to open each in turn. This is that signpost.
   */
  youAreSeated?: boolean;
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

/**
 * The web lobby only ever prints two status words — `lobby.open` for a seat
 * available, `lobby.wait` for a table it will not seat you at right now — and
 * this app's `lobby.status.*` family duplicates them under different keys.
 * Parity means OPEN/WAITING borrow the web's words so both apps read
 * identically; FULL/UNAVAILABLE have no web equivalent (the web's table type
 * only ever distinguishes open-vs-not), so those two keep the existing
 * `lobby.status.*` keys — the closest match without inventing new copy.
 */
const STATUS_LABEL_KEY: Record<TableStatus, string> = {
  OPEN: 'lobby.open',
  WAITING: 'lobby.wait',
  FULL: 'lobby.status.full',
  UNAVAILABLE: 'lobby.status.unavailable',
};

/** Sitting is refused at the others, so those rows are not made to look tappable. */
const ENTERABLE: TableStatus[] = ['OPEN', 'WAITING'];

const ALL = '__all__';

export function LobbyScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // A second, separately-typed navigation hook: `navigation` above reaches the
  // root stack (for opening a table), but Alliance is a sibling TAB, not a
  // root-stack screen, so it needs the tab navigator's own param list.
  const tabNav = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const [game, setGame] = useState<string>(ALL);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [createHintVisible, setCreateHintVisible] = useState(false);

  const games = useQuery({
    queryKey: ['lobby', 'games'],
    queryFn: () => api.get<{ games: GameSummary[]; totalJackpot: number }>('/lobby/games'),
    staleTime: 30_000,
  });

  const tables = useQuery({
    // onlyOpen is part of the key: the gateway filters server-side, so
    // switching it must refetch rather than reuse the previous page's rows.
    queryKey: ['lobby', 'tables', game, onlyOpen],
    queryFn: () => {
      const params = new URLSearchParams();
      if (game !== ALL) params.set('gameId', game);
      if (onlyOpen) params.set('hasSeats', 'true');
      const qs = params.toString();
      return api.get<{ tables: LobbyTable[] }>(`/lobby/tables${qs ? `?${qs}` : ''}`);
    },
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

  // Undefined while /lobby/games has not answered, or on error. Printing a
  // zero there would claim the pools are empty rather than unknown — the
  // exact bug an earlier audit here caught on a table's own jackpot figure.
  const totalJackpot = games.data?.totalJackpot;

  return (
    <View style={styles.container}>
      <View style={styles.jackpotCard}>
        <Text style={styles.jackpotLabel}>{t('lobby.grandJackpot')}</Text>
        {games.isPending ? (
          <Skeleton width={140} />
        ) : (
          <Text style={styles.jackpotValue}>
            {totalJackpot !== undefined ? money(totalJackpot, { decimals: 0 }) : '—'}
          </Text>
        )}
      </View>

      <View style={styles.filterBar}>
        {filters.length > 1 && <Segmented options={filters} value={game} onChange={setGame} />}

        <View style={styles.onlyOpenRow}>
          <Text style={styles.onlyOpenLabel}>{t('lobby.onlyOpen')}</Text>
          <Toggle value={onlyOpen} onChange={setOnlyOpen} />
        </View>
      </View>

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
          <>
            <Card style={styles.listCard}>
              {data.tables.map((tbl) => (
                <TableRow
                  key={tbl.id}
                  table={tbl}
                  onOpen={() => navigation.navigate('Table', { tableId: tbl.id })}
                />
              ))}
            </Card>

            <View style={styles.actionRow}>
              {/* Quick Join: the web's rule (frontend/src/pages/Lobby.tsx
                  handleQuickJoin) is "the first table in the currently
                  displayed list that is not full, else the first table in
                  that list" — not the lowest stakes, not the most players,
                  not a random pick. `data.tables` here is already the same
                  server-filtered list the rows below are rendered from, so
                  reusing it reproduces the web's rule exactly. */}
              <View style={styles.actionButton}>
                <Button
                  style={styles.actionFill}
                  variant="primary"
                  onPress={() => {
                    const target =
                      data.tables.find(
                        (tb) => tb.status !== 'FULL' && tb.players < tb.maxPlayers,
                      ) ?? data.tables[0];
                    if (target) {
                      navigation.navigate('Table', { tableId: target.id });
                    }
                  }}
                >
                  {t('lobby.quickJoin')}
                </Button>
              </View>

              {/* A private table is a LEAGUE room, opened only by that league's
               * owner or an admin from within the league — a control this
               * screen has no league context to host. The web button (see
               * frontend/src/pages/Lobby.tsx) is the same signpost: it does not
               * create anything, it surfaces `lobby.createPrivateHint` (there,
               * as a toast) and redirects to the alliance area. This app has no
               * toast system (AllianceScreen's own convention is inline text
               * instead of one), so the hint is also shown inline here — but
               * now that TabParamList is exported from navigation.ts, the
               * redirect itself is reachable too, so both halves of the web's
               * behaviour (message + navigate) are mirrored.
               */}
              <View style={styles.actionButton}>
                <Button
                  style={styles.actionFill}
                  variant="ghost"
                  onPress={() => {
                    setCreateHintVisible(true);
                    tabNav.navigate('Alliance');
                  }}
                >
                  {t('lobby.createPrivate')}
                </Button>
              </View>
            </View>
            {createHintVisible && (
              <Text style={styles.createHint}>{t('lobby.createPrivateHint')}</Text>
            )}
          </>
        )}
      </Screen>
    </View>
  );
}

function TableRow({ table, onOpen }: { table: LobbyTable; onOpen: () => void }) {
  const { t } = useTranslation();
  const name = table.name || t(`gameNames.${table.gameId}`, { defaultValue: table.gameId });

  // Seats first — it is what decides whether to tap — then the blinds as the
  // small/big pair, the way the web lobby prints them. `stakes` is the big
  // blind in TABLE CHIPS, not micro-USD: it comes straight from the room's
  // own `bigBlind` (game-server/src/live/poker-room.ts) by way of
  // `syncLobbyWithLiveTables` (game-server/src/lobby/live-sync.ts, `stakes =
  // s.bigBlind`). It was micro-USD only back when a placeholder seeder fed
  // this screen with invented tables; that seeder is gone. money() divides by
  // 1,000,000, so it turns a real 10/20 table into "0/0" — silently, since 0
  // still renders. Feeding it an actual micro value here would do the
  // opposite: print "1000000/2000000" for a 1/2 table. Chips are not
  // currency, so no money() and no micro conversion — just a formatted
  // integer.
  //
  // An em dash when the table has no blind structure at all. Nine of the
  // thirteen live tables let each player pick their own bet, and "0/0" claimed
  // a stake level none of them has (docs/TRAPS.md #3).
  //
  // The small blind is SENT, never derived. `stakes / 2` is right only while
  // every table is half-and-half — a league admin sets the two independently,
  // and Dou Di Zhu has a flat base stake of 100 with no small blind at all,
  // which a halving fallback rendered as "50/100". A game with one figure
  // shows one figure.
  const blinds =
    table.stakes === null || table.stakes === undefined
      ? '—'
      : table.smallBlind === null || table.smallBlind === undefined
        ? table.stakes.toLocaleString()
        : `${table.smallBlind.toLocaleString()}/${table.stakes.toLocaleString()}`;
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
          {/* Ahead of the status badge, because "your seat is here" is the
              more urgent fact: it is the reason every other table is refusing
              this player, and the only row that can release it. */}
          {table.youAreSeated ? <Badge tone="brand">{t('lobby.yourSeat')}</Badge> : null}
          <Badge tone={STATUS_TONE[table.status]}>
            {t(STATUS_LABEL_KEY[table.status], { defaultValue: table.status })}
          </Badge>
        </View>
      }
      {...(ENTERABLE.includes(table.status) ? { onPress: onOpen } : {})}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  jackpotCard: {
    marginHorizontal: space.lg,
    marginTop: space.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingVertical: space.lg,
    alignItems: 'center',
    gap: space.xs,
  },
  jackpotLabel: {
    color: theme.dim,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5, fontFamily: weight('800') },
  jackpotValue: {
    color: theme.jackpot,
    fontSize: 28, fontFamily: weight('900') },
  filterBar: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.sm },
  onlyOpenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: theme.surface,
  },
  onlyOpenLabel: { color: theme.text, fontSize: 13, flex: 1, paddingRight: space.sm, fontFamily: weight('400') },
  listCard: { padding: 0, paddingHorizontal: space.md, gap: 0 },
  actionRow: { flexDirection: 'row', paddingHorizontal: space.md, gap: space.sm },
  actionButton: { flex: 1 },
  // Fill the wrapper so both buttons share the tallest label's height.
  actionFill: { flex: 1, width: '100%' },
  createHint: { color: theme.dim, fontSize: 12, paddingHorizontal: space.md, fontFamily: weight('400') },
  right: { alignItems: 'flex-end', gap: space.xs },
  jackpot: {
    // The one place gold belongs: an actual jackpot figure.
    color: theme.jackpot,
    fontSize: 11, fontFamily: weight('800') },
});
