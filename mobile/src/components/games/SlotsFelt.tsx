import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SeatStrip } from './SeatStrip';
import { radius, space, theme } from '../../theme';
import type { TableCommand, TableSnapshot } from '../../lib/liveTable';

/**
 * CLASSIC SLOTS — three reels.
 *
 * Ported from `frontend/src/components/games/SlotsFelt.tsx`. The reels come from `snapshot.board`;
 * the felt spins nothing itself, it just shows what the server rolled.
 *
 * The web version pops each reel with `motion/react`. There is no animation library here, so the
 * same pop is an `Animated.sequence` on the native driver — it re-fires when the board changes,
 * which is the only time a reel should move.
 */

const SYMBOL_ICONS: Record<string, string> = {
  CHERRY: '🍒',
  BELL: '🔔',
  STAR: '⭐',
  SEVEN: '7️⃣',
};

const CHIPS = [50, 100, 500, 1_000];

export function SlotsFelt({
  snapshot,
  onCommand,
}: {
  snapshot: TableSnapshot;
  onCommand: (cmd: TableCommand) => void;
}) {
  const [wager, setWager] = useState(100);

  const phase = snapshot.phase;
  const seats = snapshot.seats;
  const you = seats.find((s) => s.isYou);
  const board = snapshot.board.length > 0 ? snapshot.board : ['CHERRY', 'BELL', 'STAR'];

  /** Take the first free chair, at the table's own minimum — seat 0 is usually already taken. */
  const sitDown = (): void => {
    const free = seats.find((s) => !s.playerId);
    onCommand({ kind: 'sit', seat: free?.index ?? 0, buyIn: snapshot.minBuyIn });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>CLASSIC SLOTS</Text>
        <Text style={styles.phase}>{phase}</Text>
      </View>

      <View style={styles.machine}>
        {board.map((sym, i) => (
          <Reel key={i} symbol={sym} />
        ))}
      </View>

      <SeatStrip seats={seats} />

      <View style={styles.controls}>
        {you ? (
          <>
            <View style={styles.chips}>
              {CHIPS.map((amt) => (
                <Pressable
                  key={amt}
                  onPress={() => setWager(amt)}
                  style={[styles.chip, wager === amt && styles.chipOn]}
                >
                  <Text style={[styles.chipText, wager === amt && styles.chipTextOn]}>₮{amt}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => onCommand({ kind: 'act', action: { type: 'spin', amount: wager } })}
              style={styles.primary}
            >
              <Text style={styles.primaryText}>SPIN (₮{wager})</Text>
            </Pressable>
          </>
        ) : (
          <Pressable onPress={sitDown} style={styles.primary}>
            <Text style={styles.primaryText}>Sit to Play Slots</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** One reel, popping whenever the symbol on it changes. */
function Reel({ symbol }: { symbol: string }) {
  const pop = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.sequence([
      Animated.timing(pop, { toValue: 0.9, duration: 90, useNativeDriver: true }),
      Animated.timing(pop, { toValue: 1.05, duration: 110, useNativeDriver: true }),
      Animated.timing(pop, { toValue: 1, duration: 90, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [symbol, pop]);

  return (
    <Animated.View style={[styles.reel, { transform: [{ scale: pop }] }]}>
      <Text style={styles.reelText}>{SYMBOL_ICONS[symbol] ?? symbol}</Text>
    </Animated.View>
  );
}

/** Web paints a radial indigo gradient; this is its mid tone, flat. */
const INDIGO_FELT = '#272561';
const INDIGO_DEEP = '#1e1b4b';

const styles = StyleSheet.create({
  wrap: {
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: INDIGO_FELT,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(55,48,163,0.4)',
    paddingBottom: space.sm,
  },
  title: { color: theme.jackpot, fontWeight: '800', letterSpacing: 1 },
  phase: {
    borderRadius: 4,
    backgroundColor: 'rgba(55,48,163,0.6)',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    color: '#c7d2fe',
    fontSize: 11,
    overflow: 'hidden',
  },
  machine: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.lg,
    alignSelf: 'center',
    borderRadius: 24,
    borderWidth: 4,
    borderColor: '#f59e0b',
    backgroundColor: '#0f172a',
    padding: space.lg,
  },
  reel: {
    width: 68,
    height: 88,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(251,191,36,0.6)',
    backgroundColor: INDIGO_DEEP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reelText: { fontSize: 34 },
  controls: { alignItems: 'center', gap: space.sm },
  chips: { flexDirection: 'row', gap: space.md },
  chip: {
    borderRadius: radius.pill,
    backgroundColor: INDIGO_DEEP,
    paddingHorizontal: space.md,
    paddingVertical: 5,
  },
  chipOn: { backgroundColor: theme.jackpot },
  chipText: { color: '#c7d2fe', fontSize: 11, fontWeight: '700' },
  chipTextOn: { color: '#000' },
  primary: {
    borderRadius: radius.card,
    backgroundColor: theme.brand,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
