import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { PlayingCard } from '../poker/PlayingCard';
import type { TableCommand, TableSnapshot } from '../../lib/liveTable';

/**
 * TEXAS COWBOY — laid out after the reference's Cowboy screen, as closely as the owner asked.
 *
 * Ported from `frontend/src/components/games/TexasCowboyFelt.tsx`, which carries the full reasoning;
 * the short version, so this file stands on its own:
 *
 *   OUR BETS, THEIR LAYOUT. Each server market keeps its own cell. The reference's merged cells
 *   ("High card / One pair", "Three of a kind / Straight / Flush") are split in place, because a
 *   merged tap could not say which bet it placed. Its "Either hand type" block has no market here
 *   and is not drawn.
 *
 *   THE ODDS ARE OURS — every multiplier comes from the round.
 *
 *   THE CHARACTERS ARE PLACEHOLDERS until ours are drawn.
 *
 *   NO FIGURE IS INVENTED. Trails come only from what the server recorded; a vacancy that is a
 *   lower bound prints with "+".
 *
 *   NO GROUND OF ITS OWN. Every surface is translucent over the table's ground.
 *
 * TYPE: the web board uses Oswald, a condensed face. The app loads only Nunito, and adding a font
 * family is a package and a native rebuild, so this uses Nunito's heavy weights with tightened
 * tracking — closest to the reference without a new dependency.
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
  /** Per market, whether each of the last rounds paid it, oldest first. */
  marketHistory?: Record<string, boolean[]>;
  /** Per market, rounds since it last paid. `exact: false` means "at least". */
  vacant?: Record<string, { rounds: number; exact: boolean }>;
}

/** The reference's wording for each of our markets. Kept in step with the web felt by hand. */
const LABEL: Record<string, string> = {
  cowboy_win: 'Cowboy Win',
  tie: 'Push',
  cowgirl_win: 'Cowgirl Win',
  high_card: 'High card',
  one_pair: 'One pair',
  two_pair: 'Two pairs',
  three_of_a_kind: 'Three of a kind',
  straight: 'Straight',
  flush: 'Flush',
  full_house: 'Full House',
  four_of_a_kind: 'Four of a kind',
  straight_flush: 'Straight Flush',
  royal_flush: 'Royal Flush',
};

/** From this multiplier up a cell shows "N hands vacant" instead of dots — as the reference does. */
const LONG_SHOT = 20;
const CHIPS = [100, 500, 1_000, 5_000];

const GOLD = '#d4b26a';
const GOLD_LINE = 'rgba(212,178,106,0.45)';
const CREAM = '#f4ecd6';
const OUTCOMES = new Set(['cowboy_win', 'cowgirl_win', 'tie']);

export function TexasCowboyFelt({
  snapshot,
  onCommand,
  onSit,
}: {
  snapshot: TableSnapshot;
  onCommand: (cmd: TableCommand) => void;
  /**
   * Taking a seat opens the buy-in sheet — it does NOT commit one. Required, not optional: a felt
   * that cannot open the sheet must not fall back to spending.
   */
  onSit: (seatIndex: number) => void;
}) {
  const [chip, setChip] = useState(100);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const round = (snapshot.gameState as TexasCowboyRound | undefined) ?? null;
  const seats = snapshot.seats;
  const you = seats.find((s) => s.isYou);

  const sitDown = (): void => {
    const free = seats.find((s) => !s.playerId);
    onSit(free?.index ?? 0);
  };

  const closesAt = snapshot.actionDeadline ?? round?.bettingWindow?.closesAt ?? 0;
  const remaining = Math.max(0, closesAt - now);
  const isBettingOpen = round?.phase === 'BETTING_OPEN';
  const canBet = isBettingOpen && Boolean(you);

  const bet = (marketId: string): void => {
    if (!canBet) return;
    onCommand({ kind: 'act', action: { type: 'bet', amount: chip, selection: marketId } });
  };

  const cell = (id: string, opts: { flex?: number; small?: boolean; last?: boolean } = {}) => (
    <MarketCell
      key={id}
      label={LABEL[id] ?? id}
      odds={round?.markets.find((m) => m.id === id)?.multiplier ?? 0}
      pool={round?.pools?.[id] ?? 0}
      yours={round?.yourStakes?.[id] ?? 0}
      trail={round?.marketHistory?.[id]}
      vacant={round?.vacant?.[id]}
      showTrail={!OUTCOMES.has(id)}
      open={canBet}
      flex={opts.flex ?? 1}
      small={Boolean(opts.small)}
      last={Boolean(opts.last)}
      onBet={() => bet(id)}
    />
  );

  return (
    <View style={styles.wrap}>
      {/* ── The scene ─────────────────────────────────────────────────────── */}
      <View style={styles.scene}>
        <Duelist
          side="left"
          figure="🤠"
          cards={round?.cowboy.holeCards ?? []}
          won={round?.result?.winner === 'COWBOY'}
          hand={round?.cowboy.evaluation?.displayName}
        />
        <Duelist
          side="right"
          figure="💃"
          cards={round?.cowgirl.holeCards ?? []}
          won={round?.result?.winner === 'COWGIRL'}
          hand={round?.cowgirl.evaluation?.displayName}
        />

        {isBettingOpen && remaining > 0 ? (
          <View style={[styles.clock, remaining <= 3_000 && styles.clockLate]}>
            <Text style={[styles.clockText, remaining <= 3_000 && styles.clockTextLate]}>
              {Math.ceil(remaining / 1_000)}
            </Text>
          </View>
        ) : null}

        {/* The board, dealt between them: face-up once revealed, red backs until. */}
        <View style={styles.community}>
          {Array.from({ length: 5 }, (_, i) => {
            const card = round?.communityCards[i];
            return card ? (
              <PlayingCard key={i} card={card} size="md" />
            ) : (
              <CardBack key={i} width={44} height={64} />
            );
          })}
        </View>

        {/* The table's name where the reference prints its stake tier, then the road. */}
        <View style={styles.roadWrap}>
          <Text style={styles.tableName} numberOfLines={1}>
            {snapshot.name ?? ''}
          </Text>
          <View style={styles.road}>
            <Text style={styles.roadIcon}>🂠</Text>
            <View style={styles.roadDots}>
              {(round?.history ?? []).slice(-10).map((w, i) => (
                <View
                  key={i}
                  style={[
                    styles.roadDot,
                    { backgroundColor: w === 'COWBOY' ? '#2cc4c9' : w === 'COWGIRL' ? '#d42a3c' : GOLD },
                  ]}
                />
              ))}
            </View>
          </View>
        </View>

        {round?.result ? <ResultBanner result={round.result} /> : null}
      </View>

      {/* ── The paytable ──────────────────────────────────────────────────── */}
      <View style={styles.tables}>
        <View style={styles.block}>
          <View style={styles.row}>
            {cell('cowboy_win', { flex: 1.2 })}
            {cell('tie', { flex: 0.9 })}
            {cell('cowgirl_win', { flex: 1.2, last: true })}
          </View>
        </View>

        <View style={styles.block}>
          <View style={styles.row}>
            <View style={styles.rankLabel}>
              <Text style={styles.rankLabelText}>{'Winning\nhand rank'}</Text>
            </View>
            {cell('high_card')}
            {cell('one_pair')}
            {cell('two_pair', { last: true })}
          </View>
          <View style={[styles.row, styles.rowRule]}>
            {cell('three_of_a_kind', { small: true })}
            {cell('straight')}
            {cell('flush', { last: true })}
          </View>
          <View style={[styles.row, styles.rowRule]}>
            {cell('full_house', { small: true })}
            {cell('four_of_a_kind', { small: true })}
            {cell('straight_flush', { small: true })}
            {cell('royal_flush', { small: true, last: true })}
          </View>
        </View>
      </View>

      {/* ── Join, or your chips ───────────────────────────────────────────── */}
      <View style={styles.footer}>
        {!you ? (
          <Pressable onPress={sitDown} style={styles.join} accessibilityRole="button">
            <Text style={styles.joinText}>Join Game</Text>
          </Pressable>
        ) : (
          <View style={styles.seated}>
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
            <View style={styles.balanceBox}>
              <Text style={styles.hint}>{isBettingOpen ? `Tap a bet to stake ${chip}` : 'Betting is closed'}</Text>
              <Text style={styles.balance}>{you.stack}</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

/** The reference's card back: red, inside a white border. */
function CardBack({ width, height, style }: { width: number; height: number; style?: object }) {
  return (
    <View style={[styles.back, { width, height }, style]}>
      <View style={styles.backInner} />
    </View>
  );
}

/** One of the two figures, at their end of the scene, holding their two cards. */
function Duelist({
  side,
  figure,
  cards,
  won,
  hand,
}: {
  side: 'left' | 'right';
  figure: string;
  cards: string[];
  won: boolean;
  hand?: string | undefined;
}) {
  return (
    <View style={[styles.duelist, side === 'left' ? styles.duelistLeft : styles.duelistRight]}>
      {/* PLACEHOLDER FIGURE — the illustration goes here, bottom-anchored. */}
      <Text
        style={[
          styles.figure,
          side === 'right' && styles.figureFlip,
          won && styles.figureWon,
        ]}
      >
        {figure}
      </Text>
      <View style={[styles.hole, side === 'left' ? styles.holeLeft : styles.holeRight]}>
        {cards.length > 0
          ? cards.map((c, i) => (
              <View key={i} style={i > 0 ? styles.holeSecond : styles.holeFirst}>
                <PlayingCard card={c} size="md" />
              </View>
            ))
          : [0, 1].map((i) => (
              <CardBack
                key={i}
                width={46}
                height={64}
                style={i > 0 ? styles.holeSecond : styles.holeFirst}
              />
            ))}
      </View>
      {hand ? <Text style={styles.hand}>{hand}</Text> : null}
    </View>
  );
}

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

  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });
  const title =
    result.winner === 'TIE' ? 'Push' : `${result.winner === 'COWBOY' ? 'Cowboy' : 'Cowgirl'} Win`;

  return (
    <Animated.View style={[styles.result, { opacity: enter, transform: [{ scale }] }]}>
      <Text style={styles.resultText}>{title}</Text>
      {result.winningHandType ? (
        <Text style={styles.resultHand}>
          {LABEL[result.winningHandType.toLowerCase()] ?? result.winningHandType}
        </Text>
      ) : null}
    </Animated.View>
  );
}

/** One market: header strip with the chips on it, name and odds, then its trail or vacancy. */
function MarketCell({
  label,
  odds,
  pool,
  yours,
  trail,
  vacant,
  showTrail,
  open,
  flex,
  small,
  last,
  onBet,
}: {
  label: string;
  odds: number;
  pool: number;
  yours: number;
  trail: boolean[] | undefined;
  vacant: { rounds: number; exact: boolean } | undefined;
  showTrail: boolean;
  open: boolean;
  flex: number;
  small: boolean;
  last: boolean;
  onBet: () => void;
}) {
  const longShot = odds >= LONG_SHOT;

  return (
    <Pressable
      disabled={!open}
      onPress={onBet}
      style={[styles.cell, { flex }, !last && styles.cellRule, yours > 0 && styles.cellBacked]}
    >
      <View style={styles.cellHead}>
        {pool > 0 ? <Text style={styles.cellPool}>{pool}</Text> : null}
        {yours > 0 ? (
          <View style={styles.cellYours}>
            <Text style={styles.cellYoursText}>{yours}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.cellBody}>
        <Text style={[styles.cellName, small && styles.cellNameSmall]} numberOfLines={2}>
          {label}
        </Text>
        <Text style={styles.cellOdds}>{odds}x</Text>
      </View>

      {showTrail ? (
        <View style={styles.cellFoot}>
          {longShot ? (
            vacant && vacant.rounds > 0 ? (
              <Text style={styles.vacant} numberOfLines={1}>
                {vacant.rounds}
                {vacant.exact ? '' : '+'} hands vacant
              </Text>
            ) : null
          ) : (
            <View style={styles.trail}>
              {(trail ?? []).slice(-10).map((hit, i) => (
                <View key={i} style={[styles.trailDot, hit ? styles.trailHit : styles.trailMiss]} />
              ))}
            </View>
          )}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: '100%' },

  scene: { width: '100%', aspectRatio: 10 / 7, position: 'relative', overflow: 'hidden' },
  duelist: {
    position: 'absolute',
    bottom: 0,
    width: '32%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  duelistLeft: { left: 0 },
  duelistRight: { right: 0 },
  figure: { fontSize: 78, lineHeight: 88, marginBottom: -6 },
  figureFlip: { transform: [{ scaleX: -1 }] },
  figureWon: { textShadowColor: 'rgba(241,214,101,0.9)', textShadowRadius: 18 },
  hole: { flexDirection: 'row', marginBottom: '8%', zIndex: 2 },
  holeLeft: { marginLeft: '18%' },
  holeRight: { marginRight: '18%' },
  holeFirst: { transform: [{ rotate: '-6deg' }] },
  holeSecond: { marginLeft: -18, transform: [{ rotate: '6deg' }] },
  hand: {
    position: 'absolute',
    bottom: 4,
    zIndex: 3,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 5,
    color: CREAM,
    fontSize: 10,
    fontWeight: '700',
  },

  clock: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    zIndex: 20,
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: GOLD,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockLate: { borderColor: '#f43f5e' },
  clockText: { color: CREAM, fontSize: 16, fontWeight: '800' },
  clockTextLate: { color: '#fecdd3' },

  community: {
    position: 'absolute',
    top: '26%',
    alignSelf: 'center',
    zIndex: 10,
    flexDirection: 'row',
    gap: 4,
  },

  roadWrap: {
    position: 'absolute',
    bottom: '6%',
    alignSelf: 'center',
    width: '62%',
    zIndex: 20,
    alignItems: 'center',
    gap: 5,
  },
  tableName: { color: CREAM, fontSize: 12, fontWeight: '600' },
  road: {
    width: '100%',
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(42,18,12,0.85)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    gap: 6,
  },
  roadIcon: { color: CREAM, fontSize: 14 },
  roadDots: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 5, overflow: 'hidden' },
  roadDot: { width: 10, height: 10, borderRadius: 5 },

  result: {
    position: 'absolute',
    top: '16%',
    alignSelf: 'center',
    zIndex: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GOLD,
    backgroundColor: 'rgba(20,12,6,0.85)',
    paddingHorizontal: 26,
    paddingVertical: 10,
    alignItems: 'center',
  },
  resultText: { color: CREAM, fontSize: 22, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  resultHand: { marginTop: 2, color: GOLD, fontSize: 13, fontWeight: '700' },

  tables: { paddingHorizontal: 10, paddingTop: 4, paddingBottom: 12, gap: 12 },
  block: {
    borderWidth: 1,
    borderColor: 'rgba(212,178,106,0.6)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  rowRule: { borderTopWidth: 1, borderTopColor: GOLD_LINE },
  rankLabel: {
    flex: 0.95,
    backgroundColor: 'rgba(0,0,0,0.32)',
    borderRightWidth: 1,
    borderRightColor: GOLD_LINE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  rankLabelText: { color: GOLD, fontSize: 15, fontWeight: '800', textAlign: 'center', letterSpacing: -0.3 },

  cell: { backgroundColor: 'rgba(255,255,255,0.025)' },
  cellRule: { borderRightWidth: 1, borderRightColor: GOLD_LINE },
  cellBacked: { backgroundColor: 'rgba(241,214,101,0.12)' },
  cellHead: {
    height: 22,
    backgroundColor: 'rgba(0,0,0,0.28)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  cellPool: { color: CREAM, opacity: 0.8, fontSize: 10, fontWeight: '700' },
  cellYours: { borderRadius: 999, backgroundColor: '#f1d665', paddingHorizontal: 5 },
  cellYoursText: { color: '#5c3a12', fontSize: 10, fontWeight: '800' },
  cellBody: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, paddingVertical: 9 },
  cellName: { color: CREAM, fontSize: 16, fontWeight: '800', textAlign: 'center', letterSpacing: -0.4 },
  cellNameSmall: { fontSize: 12, letterSpacing: -0.2 },
  cellOdds: { marginTop: 4, color: CREAM, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  cellFoot: { height: 14, alignItems: 'center', justifyContent: 'center', paddingBottom: 3 },
  vacant: { color: GOLD, fontSize: 10 },
  trail: { flexDirection: 'row', gap: 3 },
  trailDot: { width: 7, height: 7, borderRadius: 3.5 },
  trailHit: { backgroundColor: '#e8956b' },
  trailMiss: { backgroundColor: 'rgba(170,176,172,0.75)' },

  back: {
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#ffffff',
    backgroundColor: '#e07682',
    padding: 3,
  },
  backInner: {
    flex: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },

  footer: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 16 },
  join: { borderRadius: 999, backgroundColor: '#f1d665', paddingVertical: 13, alignItems: 'center' },
  joinText: { color: '#8a5620', fontSize: 20, fontWeight: '600' },
  seated: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: 'rgba(212,178,106,0.5)',
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { borderColor: GOLD, backgroundColor: '#f1d665' },
  chipText: { color: CREAM, fontSize: 11, fontWeight: '800' },
  chipTextOn: { color: '#5c3a12' },
  balanceBox: { alignItems: 'flex-end' },
  hint: { color: CREAM, fontSize: 11 },
  balance: { color: GOLD, fontSize: 14, fontWeight: '700' },
});
