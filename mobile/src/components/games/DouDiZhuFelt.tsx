import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TableNotice } from './TableNotice';
import { radius, space, theme } from '../../theme';
import type { TableCommand, TableSnapshot } from '../../lib/liveTable';

/**
 * DOU DI ZHU — landlord against two peasants.
 *
 * Ported from `frontend/src/components/games/DouDiZhuFelt.tsx`. Three areas, read top to bottom:
 * the other two players, the trick in the middle, your hand at the bottom.
 *
 * Bidding and card play are both `IN_HAND`; the server tells us which one we are in via
 * `snapshot.stage`, and the controls follow it — you cannot bid during a trick, and you cannot play
 * a card during the auction.
 *
 * The web version draws its own card faces inline. Here the hand uses the shared `PlayingCard`
 * only for the trick area; the hand itself stays a custom lift-on-select card because selecting is
 * the whole interaction and `PlayingCard` has no selected state.
 */

const RANK_SUIT_SYMBOLS: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

function formatCard(card: string): { rank: string; suit: string; red: boolean } {
  if (card === 'js') return { rank: 'S', suit: '🃏', red: false };
  if (card === 'jb') return { rank: 'B', suit: '🃏', red: true };
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  return { rank, suit: RANK_SUIT_SYMBOLS[suit] ?? suit, red: suit === 'h' || suit === 'd' };
}

export function DouDiZhuFelt({
  snapshot,
  onCommand,
}: {
  snapshot: TableSnapshot;
  onCommand: (cmd: TableCommand) => void;
}) {
  const [selectedCards, setSelectedCards] = useState<string[]>([]);

  const phase = snapshot.phase;
  const seats = snapshot.seats;
  const youSeat = seats.find((s) => s.isYou);
  const myCards = (youSeat?.cards ?? []).filter((c): c is string => typeof c === 'string');
  const isMyTurn = youSeat != null && snapshot.toActSeat === youSeat.index;
  const bidding = snapshot.stage === 'BIDDING';
  const others = seats.filter((s) => s.playerId && !s.isYou);
  const board = snapshot.board;

  const toggleCard = (card: string): void => {
    setSelectedCards((prev) =>
      prev.includes(card) ? prev.filter((c) => c !== card) : [...prev, card],
    );
  };

  const handleAct = (type: string): void => {
    onCommand({ kind: 'act', action: { type } });
    setSelectedCards([]);
  };

  const handlePlaySelected = (): void => {
    if (selectedCards.length === 0) return;
    // `cards` travels INSIDE the action — the wire schema drops anything hung off the command.
    onCommand({ kind: 'act', action: { type: 'play', cards: selectedCards } });
    setSelectedCards([]);
  };

  /** Take the first free chair. Dou Di Zhu deals at three, so the table waits until it has them. */
  const sitDown = (): void => {
    const free = seats.find((s) => !s.playerId);
    onCommand({ kind: 'sit', seat: free?.index ?? 0, buyIn: snapshot.minBuyIn });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>DOU DI ZHU</Text>
          <Text style={styles.phase}>{phase}</Text>
        </View>
        <View style={styles.bonus}>
          <Text style={styles.bonusLabel}>Bonus:</Text>
          {/* Drawn, not the 🂠 glyph the web felt uses — that codepoint has no coverage in the
              Android system font and renders as a blank box on device. */}
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.bonusCard}>
              <View style={styles.bonusCardInner} />
            </View>
          ))}
        </View>
      </View>

      {/* The other two players — whoever they turn out to be. A chair is drawn as a bot only when
          the server says it is one; at a table of three people, none of them are. */}
      <View style={styles.others}>
        {others.map((seat) => (
          <View
            key={seat.index}
            style={[styles.other, seat.index === snapshot.toActSeat && styles.otherToAct]}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{seat.isBot ? 'AI' : seat.name.slice(0, 1).toUpperCase()}</Text>
              {seat.isDealer ? <Text style={styles.crown}>👑</Text> : null}
            </View>
            <View style={styles.otherInfo}>
              <Text style={styles.otherName} numberOfLines={1}>
                {seat.name}
              </Text>
              <Text style={styles.otherRole}>
                {seat.isDealer ? 'Landlord' : 'Peasant'}
                {seat.isBot ? ' · AI' : ''}
              </Text>
            </View>
            <Text style={styles.otherCards}>{seat.cards.length} Cards</Text>
          </View>
        ))}
      </View>

      {/* The trick */}
      <View style={styles.trick}>
        {board.length > 0 ? (
          <View style={styles.trickInner}>
            <View style={styles.trickCards}>
              {board.map((card, idx) => {
                const { rank, suit, red } = formatCard(card);
                return (
                  <View key={idx} style={styles.trickCard}>
                    <Text style={[styles.trickRank, red && styles.red]}>{rank}</Text>
                    <Text style={[styles.trickSuit, red && styles.red]}>{suit}</Text>
                  </View>
                );
              })}
            </View>
            {snapshot.message ? <Text style={styles.trickMessage}>{snapshot.message}</Text> : null}
          </View>
        ) : (
          <Text style={styles.trickEmpty}>Trick Area</Text>
        )}
      </View>

      {/* Your hand */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hand}>
        {myCards.map((card, idx) => (
          <HandCard
            key={`${card}-${idx}`}
            card={card}
            selected={selectedCards.includes(card)}
            onPress={() => toggleCard(card)}
          />
        ))}
      </ScrollView>

      {/* Controls. Which ones you get depends on the stage the server reports. */}
      <View style={styles.controls}>
        {phase === 'IN_HAND' && isMyTurn && bidding ? (
          <>
            <Text style={styles.bidPrompt}>Bid for the landlord’s chair:</Text>
            <View style={styles.row}>
              {[0, 1, 2, 3].map((points) => (
                <Pressable
                  key={points}
                  onPress={() => handleAct(`bid-${points}`)}
                  style={[styles.btn, points === 0 ? styles.btnSecondary : styles.btnPrimary]}
                >
                  <Text style={points === 0 ? styles.btnSecondaryText : styles.btnPrimaryText}>
                    {points === 0 ? 'Pass' : points}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {phase === 'IN_HAND' && isMyTurn && !bidding ? (
          <View style={styles.row}>
            <Pressable
              onPress={() => handleAct('pass')}
              disabled={board.length === 0}
              style={[styles.btn, styles.btnSecondary, board.length === 0 && styles.btnOff]}
            >
              <Text style={styles.btnSecondaryText}>Pass</Text>
            </Pressable>
            <Pressable
              onPress={handlePlaySelected}
              disabled={selectedCards.length === 0}
              style={[styles.btn, styles.btnPrimary, selectedCards.length === 0 && styles.btnOff]}
            >
              <Text style={styles.btnPrimaryText}>Play Selected ({selectedCards.length})</Text>
            </Pressable>
          </View>
        ) : null}

        {phase === 'IN_HAND' && !isMyTurn && youSeat ? (
          <Text style={styles.waiting}>Waiting for the other players…</Text>
        ) : null}

        {phase !== 'IN_HAND' && !youSeat ? (
          <Pressable onPress={sitDown} style={[styles.btn, styles.btnPrimary]}>
            <Text style={styles.btnPrimaryText}>Sit &amp; Start Game</Text>
          </Pressable>
        ) : null}

        {/* Seated at a table that cannot deal yet — say who it is waiting for. */}
        {phase === 'WAITING' && youSeat ? <TableNotice snapshot={snapshot} /> : null}

        {phase === 'SHOWDOWN' && youSeat ? (
          <Text style={styles.showdown}>{snapshot.message ?? 'Hand over'}</Text>
        ) : null}
      </View>
    </View>
  );
}

/** One card in your hand. Selecting lifts it, the way picking a card off a fan does. */
function HandCard({
  card,
  selected,
  onPress,
}: {
  card: string;
  selected: boolean;
  onPress: () => void;
}) {
  const lift = useRef(new Animated.Value(selected ? -16 : 0)).current;
  const { rank, suit, red } = formatCard(card);

  useEffect(() => {
    const anim = Animated.timing(lift, {
      toValue: selected ? -16 : 0,
      duration: 120,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [selected, lift]);

  return (
    <Pressable onPress={onPress}>
      <Animated.View
        style={[styles.handCard, selected && styles.handCardOn, { transform: [{ translateY: lift }] }]}
      >
        <Text style={[styles.handRank, red && styles.red]}>{rank}</Text>
        <Text style={[styles.handSuit, red && styles.red]}>{suit}</Text>
      </Animated.View>
    </Pressable>
  );
}

/** Web paints a radial emerald gradient; this is its mid tone, flat. */
const GREEN_FELT = '#053f30';
const GREEN_DEEP = '#022c22';

const styles = StyleSheet.create({
  wrap: {
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: GREEN_FELT,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(6,95,70,0.4)',
    paddingBottom: space.sm,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { color: theme.jackpot, fontWeight: '800', letterSpacing: 1 },
  phase: {
    borderRadius: 4,
    backgroundColor: 'rgba(6,95,70,0.6)',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    color: '#a7f3d0',
    fontSize: 11,
    overflow: 'hidden',
  },
  bonus: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bonusLabel: { color: '#6ee7b7', fontSize: 10 },
  bonusCard: {
    width: 22,
    height: 32,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.4)',
    backgroundColor: 'rgba(69,26,3,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bonusCardInner: {
    width: 12,
    height: 20,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.55)',
    backgroundColor: 'rgba(245,158,11,0.18)',
  },
  others: { gap: space.sm },
  other: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(4,120,87,0.5)',
    backgroundColor: 'rgba(6,78,59,0.3)',
    padding: space.sm,
  },
  otherToAct: { borderColor: theme.jackpot, backgroundColor: 'rgba(69,26,3,0.3)', borderWidth: 2 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#059669',
    backgroundColor: '#065f46',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#d1fae5', fontSize: 12, fontWeight: '800' },
  crown: { position: 'absolute', top: -6, right: -6, fontSize: 12 },
  otherInfo: { flex: 1, minWidth: 0 },
  otherName: { color: theme.text, fontSize: 13, fontWeight: '700' },
  otherRole: { color: '#6ee7b7', fontSize: 11 },
  otherCards: { color: '#fcd34d', fontSize: 11, fontWeight: '700' },
  trick: {
    minHeight: 110,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(5,150,105,0.3)',
    backgroundColor: 'rgba(6,78,59,0.2)',
    padding: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trickInner: { alignItems: 'center', gap: space.sm },
  trickCards: { flexDirection: 'row', gap: 3, flexWrap: 'wrap', justifyContent: 'center' },
  trickCard: {
    width: 42,
    height: 60,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    padding: 3,
    justifyContent: 'space-between',
  },
  trickRank: { color: '#0f172a', fontSize: 12, fontWeight: '700' },
  trickSuit: { color: '#0f172a', fontSize: 14, alignSelf: 'center' },
  trickMessage: {
    borderRadius: radius.pill,
    backgroundColor: 'rgba(245,158,11,0.2)',
    paddingHorizontal: space.md,
    paddingVertical: 4,
    color: '#fcd34d',
    fontSize: 11,
    fontWeight: '500',
    overflow: 'hidden',
  },
  trickEmpty: { color: 'rgba(52,211,153,0.6)', fontSize: 11 },
  hand: { gap: 3, paddingVertical: space.lg, paddingHorizontal: space.xs, alignItems: 'center' },
  handCard: {
    width: 52,
    height: 76,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    padding: 5,
    justifyContent: 'space-between',
  },
  handCardOn: { borderColor: theme.jackpot, borderWidth: 3, backgroundColor: '#fffbeb' },
  handRank: { color: '#0f172a', fontSize: 14, fontWeight: '700' },
  handSuit: { color: '#0f172a', fontSize: 18, alignSelf: 'center' },
  red: { color: '#ef4444' },
  controls: { minHeight: 36, alignItems: 'center', gap: space.sm },
  bidPrompt: { color: '#6ee7b7', fontSize: 11 },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
  btn: { borderRadius: radius.card, paddingHorizontal: 16, paddingVertical: 9 },
  btnPrimary: { backgroundColor: theme.brand },
  btnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  btnSecondary: { backgroundColor: GREEN_DEEP, borderWidth: 1, borderColor: '#047857' },
  btnSecondaryText: { color: '#a7f3d0', fontSize: 13, fontWeight: '700' },
  btnOff: { opacity: 0.4 },
  waiting: { color: 'rgba(110,231,183,0.7)', fontSize: 11 },
  showdown: { color: '#fcd34d', fontSize: 11 },
});
