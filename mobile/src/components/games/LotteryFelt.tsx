import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SeatStrip } from './SeatStrip';
import { TableNotice } from './TableNotice';
import { radius, space, theme } from '../../theme';
import type { TableCommand, TableSnapshot } from '../../lib/liveTable';

/**
 * LOTTERY DRAW — pick a number, buy the ticket.
 *
 * Ported from `frontend/src/components/games/LotteryFelt.tsx`. Ten numbers, one stake, one draw.
 * The felt holds the selection only; the ticket is not bought until you press the button, because
 * tapping a number should never spend money on its own.
 */

const CHIPS = [50, 100, 500, 1_000];

export function LotteryFelt({
  snapshot,
  onCommand,
}: {
  snapshot: TableSnapshot;
  onCommand: (cmd: TableCommand) => void;
}) {
  const [selectedNum, setSelectedNum] = useState(0);
  const [betAmount, setBetAmount] = useState(100);

  const phase = snapshot.phase;
  const seats = snapshot.seats;
  const you = seats.find((s) => s.isYou);

  /** Take the first free chair, at the table's own minimum — seat 0 is usually already taken. */
  const sitDown = (): void => {
    const free = seats.find((s) => !s.playerId);
    onCommand({ kind: 'sit', seat: free?.index ?? 0, buyIn: snapshot.minBuyIn });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>LOTTERY DRAW</Text>
        <Text style={styles.phase}>{phase}</Text>
      </View>

      <View style={styles.numbers}>
        {Array.from({ length: 10 }, (_, n) => (
          <Pressable
            key={n}
            onPress={() => setSelectedNum(n)}
            style={[styles.number, selectedNum === n && styles.numberOn]}
          >
            <Text style={[styles.numberText, selectedNum === n && styles.numberTextOn]}>#{n}</Text>
          </Pressable>
        ))}
      </View>

      <SeatStrip seats={seats} />

      <View style={styles.controls}>
        {you && phase === 'IN_HAND' ? (
          <>
            <View style={styles.chips}>
              {CHIPS.map((amt) => (
                <Pressable
                  key={amt}
                  onPress={() => setBetAmount(amt)}
                  style={[styles.chip, betAmount === amt && styles.chipOn]}
                >
                  <Text style={[styles.chipText, betAmount === amt && styles.chipTextOn]}>
                    ₮{amt}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() =>
                onCommand({
                  kind: 'act',
                  action: { type: String(selectedNum), amount: betAmount },
                })
              }
              style={styles.primary}
            >
              <Text style={styles.primaryText}>
                Buy Ticket #{selectedNum} (₮{betAmount})
              </Text>
            </Pressable>
          </>
        ) : you ? (
          <TableNotice snapshot={snapshot} />
        ) : (
          <Pressable onPress={sitDown} style={styles.primary}>
            <Text style={styles.primaryText}>Sit to Play Lottery</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** Web paints a radial purple gradient; this is its mid tone, flat. */
const PURPLE_FELT = '#3f1470';
const PURPLE_DEEP = '#2e1065';
const PURPLE_LINE = 'rgba(107,33,168,0.4)';

const styles = StyleSheet.create({
  wrap: {
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: PURPLE_FELT,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: PURPLE_LINE,
    paddingBottom: space.sm,
  },
  title: { color: theme.jackpot, fontWeight: '800', letterSpacing: 1 },
  phase: {
    borderRadius: 4,
    backgroundColor: 'rgba(107,33,168,0.6)',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    color: '#e9d5ff',
    fontSize: 11,
    overflow: 'hidden',
  },
  numbers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  number: {
    width: 56,
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#7e22ce',
    backgroundColor: 'rgba(88,28,135,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberOn: { borderColor: theme.jackpot, backgroundColor: '#f59e0b', borderWidth: 3 },
  numberText: { color: '#e9d5ff', fontSize: 18, fontWeight: '700' },
  numberTextOn: { color: '#000' },
  controls: { alignItems: 'center', gap: space.sm },
  chips: { flexDirection: 'row', gap: space.md },
  chip: {
    borderRadius: radius.pill,
    backgroundColor: PURPLE_DEEP,
    paddingHorizontal: space.md,
    paddingVertical: 5,
  },
  chipOn: { backgroundColor: theme.jackpot },
  chipText: { color: '#e9d5ff', fontSize: 11, fontWeight: '700' },
  chipTextOn: { color: '#000' },
  primary: {
    borderRadius: radius.card,
    backgroundColor: theme.brand,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
