import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { PlayingCard } from '../poker/PlayingCard';
import { radius, space, theme } from '../../theme';
import type { TableCommand, TableSnapshot } from '../../lib/liveTable';

/**
 * TEXAS COWBOY — a betting board, not a poker seat.
 *
 * Ported from `frontend/src/components/games/TexasCowboyFelt.tsx`. Two hands are dealt, Cowboy and
 * Cowgirl, and nobody plays them: the table bets on the outcome. So the screen is read top to
 * bottom — the scene, then the board. Tap a chip, tap a market, the bet is placed; there is no
 * separate confirm step, because a window that closes in twelve seconds cannot afford one.
 *
 * The server owns every number here. Odds, stakes and the road all come from the round; the felt
 * never multiplies anything out.
 */

export type PokerHandType =
  | 'HIGH_CARD'
  | 'ONE_PAIR'
  | 'TWO_PAIR'
  | 'THREE_OF_A_KIND'
  | 'STRAIGHT'
  | 'FLUSH'
  | 'FULL_HOUSE'
  | 'FOUR_OF_A_KIND'
  | 'STRAIGHT_FLUSH'
  | 'ROYAL_FLUSH';

export interface TexasCowboyRound {
  id: string;
  roundNumber: number;
  phase: string;
  bettingWindow: { openedAt: number; closesAt: number } | null;
  cowboy: { holeCards: string[]; evaluation: { type: PokerHandType; displayName: string } | null };
  cowgirl: { holeCards: string[]; evaluation: { type: PokerHandType; displayName: string } | null };
  communityCards: string[];
  markets: { id: string; name: string; multiplier: number; enabled: boolean }[];
  result: { winner: 'COWBOY' | 'COWGIRL' | 'TIE'; winningHandType: PokerHandType | null } | null;
  /** Chips the whole table has on each market. Public, like chips on a felt. */
  pools?: Record<string, number>;
  /** Chips YOU have on each market. Present only in your own snapshot. */
  yourStakes?: Record<string, number>;
  /** Who won the last rounds, oldest first. The road. */
  history?: Array<'COWBOY' | 'COWGIRL' | 'TIE'>;
}

/** The board, in the rows it is read in. */
const ROWS: Array<{ label: string; markets: string[] }> = [
  { label: 'Who wins', markets: ['cowboy_win', 'tie', 'cowgirl_win'] },
  { label: 'Either hand makes', markets: ['high_card', 'one_pair', 'two_pair'] },
  { label: 'Winning hand', markets: ['three_of_a_kind', 'straight', 'flush'] },
  { label: 'Long shots', markets: ['full_house', 'four_of_a_kind', 'straight_flush', 'royal_flush'] },
];

const CHIPS = [100, 500, 1_000, 5_000];

const titleOf = (id: string): string =>
  id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function TexasCowboyFelt({
  snapshot,
  onCommand,
}: {
  snapshot: TableSnapshot;
  onCommand: (cmd: TableCommand) => void;
}) {
  const [chip, setChip] = useState(100);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  // The round arrives in its own field. It used to be JSON stuffed into `message` — the line the
  // result banner prints — which put the whole round state on screen as text.
  const round = (snapshot.gameState as TexasCowboyRound | undefined) ?? null;
  const seats = snapshot.seats;
  const you = seats.find((s) => s.isYou);

  const sitDown = (): void => {
    const free = seats.find((s) => !s.playerId);
    onCommand({ kind: 'sit', seat: free?.index ?? 0, buyIn: snapshot.minBuyIn });
  };

  const closesAt = snapshot.actionDeadline ?? round?.bettingWindow?.closesAt ?? 0;
  const remaining = Math.max(0, closesAt - now);
  const isBettingOpen = round?.phase === 'BETTING_OPEN';

  const oddsOf = (id: string): number => round?.markets.find((m) => m.id === id)?.multiplier ?? 0;
  const poolOf = (id: string): number => round?.pools?.[id] ?? 0;
  const yoursOn = (id: string): number => round?.yourStakes?.[id] ?? 0;

  const bet = (marketId: string): void => {
    if (!isBettingOpen || !you) return;
    onCommand({ kind: 'act', action: { type: 'bet', amount: chip, selection: marketId } });
  };

  return (
    <View style={styles.wrap}>
      {/*
        The scene: the two of them facing each other, the community cards dealt between them, the
        clock above. It is the top of the screen and the board is everything below, because that is
        the order the game is read in — watch the hands, then back a market.
      */}
      <View style={styles.scene}>
        <View style={styles.clock}>
          {remaining > 0 && isBettingOpen ? (
            <View style={[styles.clockDial, remaining > 3_000 ? styles.clockOk : styles.clockLate]}>
              <Text style={[styles.clockText, remaining > 3_000 ? styles.clockTextOk : styles.clockTextLate]}>
                {Math.ceil(remaining / 1_000)}s
              </Text>
            </View>
          ) : (
            <Text style={styles.clockClosed}>
              {round?.phase === 'SETTLED' ? 'SETTLED' : 'BETS CLOSED'}
            </Text>
          )}
        </View>

        <View style={styles.duelists}>
          <Duelist
            title="COWBOY"
            emoji="🤠"
            accent="#fde68a"
            cards={round?.cowboy.holeCards ?? []}
            hand={round?.cowboy.evaluation?.displayName}
            won={round?.result?.winner === 'COWBOY'}
          />

          {/* The community cards, dealt between them */}
          <View style={styles.community}>
            {Array.from({ length: 5 }, (_, i) => {
              const card = round?.communityCards[i];
              return <PlayingCard key={i} {...(card ? { card } : {})} size="sm" />;
            })}
          </View>

          <Duelist
            title="COWGIRL"
            emoji="💃"
            accent="#fecdd3"
            cards={round?.cowgirl.holeCards ?? []}
            hand={round?.cowgirl.evaluation?.displayName}
            won={round?.result?.winner === 'COWGIRL'}
          />
        </View>

        {/* The road: how the last rounds went */}
        <View style={styles.road}>
          <Text style={styles.roadLabel}>ROUND #{round?.roundNumber ?? '—'}</Text>
          {(round?.history ?? []).slice(-14).map((w, i) => (
            <View
              key={i}
              style={[
                styles.roadDot,
                {
                  backgroundColor:
                    w === 'COWBOY' ? '#fbbf24' : w === 'COWGIRL' ? '#fb7185' : '#6ee7b7',
                },
              ]}
            />
          ))}
        </View>
      </View>

      {/* Result */}
      {round?.result ? <ResultBanner result={round.result} /> : null}

      {/*
        The board. One bordered grid, not floating cards: each row is a group with its name in the
        left block, and every cell carries the chips already riding on it, so a glance tells you
        where the table's money is.
      */}
      <View style={styles.board}>
        {ROWS.map((row, rowIdx) => (
          <View key={row.label} style={[styles.boardRow, rowIdx === ROWS.length - 1 && styles.boardRowLast]}>
            <View style={styles.rowLabel}>
              <Text style={styles.rowLabelText}>{row.label}</Text>
            </View>
            <View style={styles.rowCells}>
              {row.markets.map((id, cellIdx) => (
                <MarketCell
                  key={id}
                  id={id}
                  odds={oddsOf(id)}
                  pool={poolOf(id)}
                  yours={yoursOn(id)}
                  open={isBettingOpen && Boolean(you)}
                  last={cellIdx === row.markets.length - 1}
                  onBet={() => bet(id)}
                />
              ))}
            </View>
          </View>
        ))}
      </View>

      {/* Chips, or the way in */}
      <View style={styles.footer}>
        {!you ? (
          <Pressable onPress={sitDown} style={styles.join}>
            <Text style={styles.joinText}>JOIN GAME</Text>
          </Pressable>
        ) : (
          <>
            <View style={styles.chips}>
              {CHIPS.map((amt) => (
                <Pressable
                  key={amt}
                  onPress={() => setChip(amt)}
                  style={[styles.chip, chip === amt && styles.chipOn]}
                >
                  <Text style={[styles.chipText, chip === amt && styles.chipTextOn]}>
                    {amt >= 1_000 ? `${amt / 1_000}k` : amt}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View>
              <Text style={styles.hint}>
                {isBettingOpen ? `Tap a market to stake ₮${chip}` : 'Betting is closed'}
              </Text>
              <Text style={styles.balance}>Balance ₮{you.stack}</Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/** One of the two hands, standing at their end of the scene. */
function Duelist({
  title,
  accent,
  emoji,
  cards,
  hand,
  won,
}: {
  title: string;
  accent: string;
  emoji: string;
  cards: string[];
  hand?: string | undefined;
  won: boolean;
}) {
  return (
    <View style={styles.duelist}>
      <Text style={styles.duelistEmoji}>{emoji}</Text>
      <Text style={[styles.duelistTitle, { color: accent }, won && styles.duelistWon]}>{title}</Text>
      <View style={styles.duelistCards}>
        {cards.length > 0
          ? cards.map((c, i) => <PlayingCard key={i} card={c} size="sm" />)
          : [0, 1].map((i) => <PlayingCard key={i} size="sm" faceDown />)}
      </View>
      {hand ? <Text style={styles.duelistHand}>{hand}</Text> : null}
    </View>
  );
}

/** The result, popping in over the scene the way the web felt's does. */
function ResultBanner({
  result,
}: {
  result: { winner: 'COWBOY' | 'COWGIRL' | 'TIE'; winningHandType: PokerHandType | null };
}) {
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.spring(enter, { toValue: 1, friction: 6, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [result.winner, result.winningHandType, enter]);

  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  return (
    <Animated.View style={[styles.result, { opacity: enter, transform: [{ scale }] }]}>
      <Text style={styles.resultText}>
        {result.winner === 'TIE' ? 'TIE' : `${result.winner} WINS`}
      </Text>
      {result.winningHandType ? (
        <Text style={styles.resultHand}>{titleOf(result.winningHandType)}</Text>
      ) : null}
    </Animated.View>
  );
}

/** One market on the board: what the table has on it, the odds, and what you have on it. */
function MarketCell({
  id,
  odds,
  pool,
  yours,
  open,
  last,
  onBet,
}: {
  id: string;
  odds: number;
  pool: number;
  yours: number;
  open: boolean;
  last: boolean;
  onBet: () => void;
}) {
  return (
    <Pressable
      disabled={!open}
      onPress={onBet}
      style={[styles.cell, !last && styles.cellDivider, yours > 0 && styles.cellBacked]}
    >
      {/* What the table is backing, above the name — the chips on the cell. */}
      <Text style={styles.cellPool}>{pool > 0 ? `🪙 ${pool}` : ' '}</Text>
      <Text style={styles.cellName} numberOfLines={2}>
        {titleOf(id)}
      </Text>
      <Text style={styles.cellOdds}>{odds}×</Text>
      {yours > 0 ? (
        <View style={styles.cellYours}>
          <Text style={styles.cellYoursText}>₮{yours}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Web paints radial green gradients; these are their mid tones, flat. */
const SCENE_FELT = '#12523a';
const BOARD_FELT = '#0d5236';
const BOARD_EDGE = 'rgba(6,78,59,0.7)';

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.card, overflow: 'hidden', backgroundColor: '#07301f' },
  scene: { backgroundColor: SCENE_FELT, paddingVertical: space.sm, gap: space.sm },
  clock: { alignItems: 'center' },
  clockDial: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockOk: { borderColor: '#6ee7b7' },
  clockLate: { borderColor: '#f43f5e' },
  clockText: { fontSize: 17, fontWeight: '900' },
  clockTextOk: { color: '#a7f3d0' },
  clockTextLate: { color: '#fda4af' },
  clockClosed: {
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: space.md,
    paddingVertical: 4,
    color: '#a7f3d0',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    overflow: 'hidden',
  },
  duelists: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
  },
  duelist: { alignItems: 'center', width: 92 },
  duelistEmoji: { fontSize: 34 },
  duelistTitle: {
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    overflow: 'hidden',
  },
  duelistWon: { backgroundColor: 'rgba(251,191,36,0.25)' },
  duelistCards: { flexDirection: 'row', gap: 2, marginTop: 4 },
  duelistHand: {
    marginTop: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 4,
    color: '#6ee7b7',
    fontSize: 9,
    fontWeight: '700',
    overflow: 'hidden',
  },
  community: { flexDirection: 'row', gap: 2, flexShrink: 1, justifyContent: 'center' },
  road: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: space.md,
    paddingVertical: 4,
  },
  roadLabel: { color: 'rgba(167,243,208,0.7)', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  roadDot: { width: 8, height: 8, borderRadius: 4 },
  result: {
    position: 'absolute',
    top: 70,
    alignSelf: 'center',
    zIndex: 50,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#f59e0b',
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 28,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  resultText: { color: theme.text, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  resultHand: { marginTop: 4, color: theme.jackpot, fontSize: 15, fontWeight: '700' },
  board: { borderTopWidth: 2, borderBottomWidth: 2, borderColor: 'rgba(120,53,15,0.6)', backgroundColor: BOARD_FELT },
  boardRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BOARD_EDGE },
  boardRowLast: { borderBottomWidth: 0 },
  rowLabel: {
    width: 78,
    borderRightWidth: 1,
    borderRightColor: BOARD_EDGE,
    backgroundColor: '#0a4229',
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabelText: {
    color: '#fcd34d',
    fontSize: 10,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  rowCells: { flex: 1, flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, paddingVertical: space.md },
  cellDivider: { borderRightWidth: 1, borderRightColor: BOARD_EDGE },
  cellBacked: { backgroundColor: 'rgba(251,191,36,0.15)' },
  cellPool: { height: 14, color: 'rgba(255,255,255,0.9)', fontSize: 10, fontWeight: '700' },
  cellName: {
    color: '#ecfdf5',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  cellOdds: { color: '#fcd34d', fontSize: 15, fontWeight: '900' },
  cellYours: {
    position: 'absolute',
    top: 3,
    right: 3,
    borderRadius: radius.pill,
    backgroundColor: theme.jackpot,
    paddingHorizontal: 5,
  },
  cellYoursText: { color: '#000', fontSize: 9, fontWeight: '900' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  join: {
    flex: 1,
    borderRadius: radius.pill,
    backgroundColor: theme.jackpot,
    paddingVertical: 12,
    alignItems: 'center',
  },
  joinText: { color: '#000', fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  chips: { flexDirection: 'row', gap: space.sm },
  chip: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: '#047857',
    backgroundColor: '#064e3b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { borderColor: '#fcd34d', backgroundColor: '#f59e0b' },
  chipText: { color: '#a7f3d0', fontSize: 11, fontWeight: '900' },
  chipTextOn: { color: '#000' },
  hint: { color: 'rgba(167,243,208,0.8)', fontSize: 11 },
  balance: { color: theme.text, fontSize: 12, fontWeight: '700' },
});
