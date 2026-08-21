import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GAME_FELTS, feltFor } from '../components/games/registry';
import { TableDesignSheet } from '../components/poker/TableDesignSheet';
import { radius, space, theme } from '../theme';
import type { LiveSeat, TableSnapshot } from '../lib/liveTable';

/**
 * A gallery of every felt, rendered against a fixture. DEVELOPMENT ONLY.
 *
 * Why this exists: the felts were ported from the Mini App and NOBODY HAD EVER SEEN ONE RENDER —
 * not on web, not here. The app registers a `Table` route but nothing navigates to it (the lobby is
 * the shell's, and is still a placeholder), so thirteen felts were shipping as unreachable code.
 * One of them turned out to measure zero height on web for exactly this reason and nobody noticed
 * for a day.
 *
 * This is a harness, not a feature:
 *   - it is rendered only behind `__DEV__`;
 *   - every number in it is fake, and it says so on screen in the banner;
 *   - `onCommand` logs instead of sending, so nothing here can touch a real table or real money.
 *
 * It does NOT replace playing a hand against the server. It catches the class of bug that costs a
 * day — a felt that crashes, collapses, or draws the wrong game — without needing a lobby, a
 * gateway or a funded account.
 *
 * The honesty rule ("never render an invented figure") is about product screens. This is a
 * developer tool whose entire purpose is invented figures, and it is labelled as such.
 */

/** Named so it is obvious in a screenshot that none of this came from a server. */
function fakeSeat(index: number, over: Partial<LiveSeat> = {}): LiveSeat {
  return {
    index,
    playerId: `fixture-${index}`,
    name: `FIXTURE ${index}`,
    stack: 5_000,
    bet: 0,
    status: 'active',
    inHand: true,
    connected: true,
    isDealer: false,
    isWinner: false,
    isYou: false,
    cards: [],
    ...over,
  };
}

function baseSnapshot(tableId: string, over: Partial<TableSnapshot> = {}): TableSnapshot {
  return {
    tableId,
    name: tableId,
    variant: tableId,
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 1_000,
    maxBuyIn: 20_000,
    maxSeats: 6,
    phase: 'IN_HAND',
    handId: 'fixture-hand',
    handNumber: 1,
    street: null,
    pot: 1_250,
    board: [],
    seats: [
      fakeSeat(0, { isDealer: true, name: 'FIXTURE BANK' }),
      fakeSeat(1, { isYou: true, name: 'YOU (FIXTURE)', stack: 3_400 }),
      fakeSeat(2, { name: 'FIXTURE BOT', isBot: true }),
    ],
    jackpot: null,
    insurance: null,
    yourSeat: 1,
    you: { playerId: 'fixture-1', name: 'YOU (FIXTURE)', available: 9_000 },
    toActSeat: 1,
    actionDeadline: Date.now() + 12_000,
    legal: null,
    winners: [],
    serverTime: Date.now(),
    ...over,
  };
}

/** One fixture per game, shaped like what that room actually sends. */
const FIXTURES: Record<string, TableSnapshot> = {
  texas: baseSnapshot('texas', {
    board: ['As', 'Kd', '7h'],
    street: 'FLOP',
    seats: [
      fakeSeat(0, { isDealer: true, cards: [null, null] }),
      fakeSeat(1, { isYou: true, cards: ['Qs', 'Qh'] }),
    ],
  }),
  'niu-niu': baseSnapshot('niu-niu', {
    seats: [
      fakeSeat(0, { isDealer: true, cards: ['As', 'Kd', '7h', '3c', '5s'] }),
      fakeSeat(1, { isYou: true, cards: ['9s', '8d', '3h', '2c', 'Ts'] }),
    ],
  }),
  baccarat: baseSnapshot('baccarat', {
    gameState: {
      revealed: true,
      playerCards: ['As', '8d'],
      bankerCards: ['Kh', '9c'],
      playerTotal: 9,
      bankerTotal: 9,
      outcome: 'TIE',
      tiePayout: 8,
    },
  }),
  'cowboy-beauty': baseSnapshot('cowboy-beauty', {
    gameState: {
      pools: { COWBOY: 800, BEAUTY: 450 },
      cowboyCard: 'Ks',
      beautyCard: 'Qh',
      winner: 'COWBOY',
    },
  }),
  'san-zhang': baseSnapshot('san-zhang'),
  'red-packet': baseSnapshot('red-packet', {
    gameState: {
      size: 25,
      mineCount: 5,
      mines: [3, 11, 19],
      seats: [
        { index: 1, cell: 7, net: 220 },
        { index: 2, cell: 11, net: -140 },
      ],
    },
  }),
  'dou-di-zhu': baseSnapshot('dou-di-zhu', {
    stage: 'PLAYING',
    board: ['7s', '7h'],
    seats: [
      fakeSeat(0, { isDealer: true, cards: [null, null, null, null] }),
      fakeSeat(1, { isYou: true, cards: ['3s', '4h', '5d', 'Jc', 'Qs', 'Kh', 'jb'] }),
      fakeSeat(2, { isBot: true, cards: [null, null, null] }),
    ],
  }),
  lottery: baseSnapshot('lottery'),
  slots: baseSnapshot('slots', { board: ['CHERRY', 'SEVEN', 'BELL'] }),
  'texas-cowboy': baseSnapshot('texas-cowboy', {
    gameState: {
      id: 'fixture',
      roundNumber: 42,
      phase: 'BETTING_OPEN',
      bettingWindow: { openedAt: Date.now(), closesAt: Date.now() + 12_000 },
      cowboy: { holeCards: ['As', 'Ks'], evaluation: { type: 'ONE_PAIR', displayName: 'Pair of Aces' } },
      cowgirl: { holeCards: ['Qh', 'Jh'], evaluation: null },
      communityCards: ['2c', '9d', 'Ah'],
      markets: [
        { id: 'cowboy_win', name: 'Cowboy', multiplier: 1.9, enabled: true },
        { id: 'tie', name: 'Tie', multiplier: 12, enabled: true },
        { id: 'cowgirl_win', name: 'Cowgirl', multiplier: 1.9, enabled: true },
        { id: 'high_card', name: 'High Card', multiplier: 2.4, enabled: true },
        { id: 'one_pair', name: 'One Pair', multiplier: 1.6, enabled: true },
        { id: 'two_pair', name: 'Two Pair', multiplier: 3.1, enabled: true },
        { id: 'three_of_a_kind', name: 'Trips', multiplier: 9, enabled: true },
        { id: 'straight', name: 'Straight', multiplier: 14, enabled: true },
        { id: 'flush', name: 'Flush', multiplier: 18, enabled: true },
        { id: 'full_house', name: 'Full House', multiplier: 26, enabled: true },
        { id: 'four_of_a_kind', name: 'Quads', multiplier: 180, enabled: true },
        { id: 'straight_flush', name: 'Straight Flush', multiplier: 900, enabled: true },
        { id: 'royal_flush', name: 'Royal Flush', multiplier: 5_000, enabled: true },
      ],
      result: null,
      pools: { cowboy_win: 1_400, one_pair: 300 },
      yourStakes: { cowboy_win: 500 },
      history: ['COWBOY', 'COWGIRL', 'TIE', 'COWBOY', 'COWBOY'],
    },
  }),
};

const TABLE_IDS = Object.keys(GAME_FELTS);

export function FeltGalleryScreen() {
  const [selected, setSelected] = useState<string>(TABLE_IDS[0] ?? 'texas');
  const [designOpen, setDesignOpen] = useState(false);
  const Felt = feltFor(selected);
  // Poker's four ids share one felt and one fixture; anything without its own falls back to base.
  const snapshot = FIXTURES[selected] ?? baseSnapshot(selected);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.warning}>
        <Text style={styles.warningTitle}>FIXTURE DATA — DEV ONLY</Text>
        <Text style={styles.warningBody}>
          Every figure below is invented and no command is sent. This exists to look at the felts;
          it is not a table and it cannot move money.
        </Text>
      </View>

      {/* A wrapping row, not a horizontal ScrollView. Nested inside the vertical ScrollView the
          strip scrolled away and would not come back, which cost more time than the layout saved —
          and every tab has to be reachable for this screen to be worth anything. */}
      <View style={styles.picker}>
        {TABLE_IDS.map((id) => (
          <Pressable
            key={id}
            onPress={() => setSelected(id)}
            style={[styles.tab, selected === id && styles.tabOn]}
          >
            <Text style={[styles.tabText, selected === id && styles.tabTextOn]}>{id}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable onPress={() => setDesignOpen(true)} style={styles.designButton}>
        <Text style={styles.designText}>Table design…</Text>
      </Pressable>
      <TableDesignSheet open={designOpen} onClose={() => setDesignOpen(false)} />

      {Felt ? (
        <Felt
          snapshot={snapshot}
          onCommand={(cmd) => console.log('[felt-gallery] command suppressed:', JSON.stringify(cmd))}
          onSit={(seat) => console.log('[felt-gallery] sit suppressed, seat', seat)}
        />
      ) : (
        <Text style={styles.missing}>
          {selected} has no felt. check:felts should have caught this.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: space.md, gap: space.md, paddingBottom: space.xl * 2 },
  warning: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.danger,
    backgroundColor: 'rgba(248,86,119,0.1)',
    padding: space.md,
    gap: 4,
  },
  warningTitle: { color: theme.danger, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  warningBody: { color: theme.dim, fontSize: 11, lineHeight: 16 },
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingVertical: space.xs },
  tab: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  tabOn: { borderColor: theme.brand, backgroundColor: theme.surface2 },
  tabText: { color: theme.dim, fontSize: 11, fontWeight: '700' },
  tabTextOn: { color: theme.text },
  designButton: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  designText: { color: theme.dim, fontSize: 11, fontWeight: '600' },
  missing: { color: theme.danger, fontSize: 13, textAlign: 'center' },
});
