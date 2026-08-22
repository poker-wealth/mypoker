import { StyleSheet, Text, View } from 'react-native';

/**
 * A stack of chips standing for an amount.
 *
 * Ported from `frontend/src/components/poker/ChipStack.tsx`. Chips are drawn as stacked discs
 * rather than a number alone, because a pot you can see the size of reads faster than one you have
 * to parse — the same reason a real table uses them.
 *
 * The denominations are cosmetic: the SERVER owns the amount, and this only decides how to show it.
 * Nothing here is ever used to work out what a player has.
 */

/** Chip colours by denomination, largest first — the usual casino ladder. */
const DENOMS: { value: number; color: string; edge: string }[] = [
  { value: 1_000, color: '#f5c451', edge: '#8a6a24' },
  { value: 500, color: '#a855f7', edge: '#6b21a8' },
  { value: 100, color: '#1f2937', edge: '#000000' },
  { value: 25, color: '#22c55e', edge: '#15803d' },
  { value: 5, color: '#ef4444', edge: '#991b1b' },
  { value: 1, color: '#f8fafc', edge: '#94a3b8' },
];

/** At most this many discs, however large the amount — a tower of 400 chips helps nobody. */
const MAX_DISCS = 5;

export interface ChipStackProps {
  amount: number;
  /** Hide the figure and show only the discs — for a seat where space is tight. */
  hideLabel?: boolean;
}

/** Which denominations make up an amount, largest first, capped at MAX_DISCS. */
function discsFor(amount: number): string[] {
  const out: string[] = [];
  let left = amount;
  for (const d of DENOMS) {
    while (left >= d.value && out.length < MAX_DISCS) {
      out.push(d.color);
      left -= d.value;
    }
    if (out.length >= MAX_DISCS) break;
  }
  // Anything below the smallest denomination still deserves one chip, or a small bet shows nothing.
  if (out.length === 0 && amount > 0) out.push(DENOMS[DENOMS.length - 1]!.color);
  return out;
}

export function ChipStack({ amount, hideLabel }: ChipStackProps) {
  if (amount <= 0) return null;
  const discs = discsFor(amount);

  return (
    <View style={styles.wrap}>
      <View style={styles.stack}>
        {discs.map((color, i) => (
          <View
            key={i}
            style={[
              styles.disc,
              {
                backgroundColor: color,
                // Each chip sits slightly above the one below, like a real stack.
                bottom: i * 3,
                zIndex: i,
              },
            ]}
          />
        ))}
      </View>
      {!hideLabel && <Text style={styles.label}>₮{amount}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 2 },
  stack: { width: 22, height: 20, justifyContent: 'flex-end' },
  disc: {
    position: 'absolute',
    left: 0,
    width: 22,
    height: 7,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.45)',
  },
  label: { color: '#f2f2fa', fontSize: 10, fontWeight: '700' },
});
