import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, space, theme } from '../../theme';

/**
 * How many chips you bring to the table.
 *
 * Ported from `frontend/src/components/poker/BuyInSheet.tsx`. A bottom sheet, because that is what
 * it is on web and what a phone expects.
 *
 * The three limits it honours are the table's minimum, the table's maximum, and what you actually
 * have — and the last one is why the confirm button disables rather than clamping silently. The
 * server refuses a buy-in it cannot fund, so a sheet that quietly reduced your stake would be
 * lying about what happened to your money.
 */

export interface BuyInSheetProps {
  open: boolean;
  onClose: () => void;
  /** The chip range this table allows. */
  min: number;
  max: number;
  bigBlind: number;
  /** What the player has outside the table. */
  available: number;
  /** The seat being taken, or null when topping up the seat you already hold. */
  seatIndex: number | null;
  onConfirm: (amount: number) => void;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(n, hi));

export function BuyInSheet({
  open,
  onClose,
  min,
  max,
  bigBlind,
  available,
  seatIndex,
  onConfirm,
}: BuyInSheetProps) {
  // The most you could bring: the table's ceiling or your balance, whichever bites first.
  const ceiling = Math.min(max, available);
  const [amount, setAmount] = useState(min);

  useEffect(() => {
    if (open) setAmount(clamp(min, min, Math.max(min, ceiling)));
  }, [open, min, ceiling]);

  /** Big-blind multiples, the way a poker player actually thinks about a stack. */
  const presets = [20, 50, 100].map((bb) => ({ label: `${bb} BB`, value: bb * bigBlind }));
  const tooPoor = available < min;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Text style={styles.title}>
          {seatIndex === null ? 'Add chips' : `Take seat ${seatIndex + 1}`}
        </Text>

        <Text style={styles.amount}>₮{amount}</Text>
        <Text style={styles.range}>
          table allows ₮{min} – ₮{max} · you have ₮{available}
        </Text>

        <View style={styles.presets}>
          {presets.map((p) => {
            const reachable = p.value >= min && p.value <= ceiling;
            return (
              <Pressable
                key={p.label}
                disabled={!reachable}
                onPress={() => setAmount(clamp(p.value, min, ceiling))}
                style={[styles.preset, !reachable && styles.presetOff]}
              >
                <Text style={styles.presetText}>{p.label}</Text>
              </Pressable>
            );
          })}
          <Pressable
            disabled={ceiling < min}
            onPress={() => setAmount(ceiling)}
            style={[styles.preset, ceiling < min && styles.presetOff]}
          >
            <Text style={styles.presetText}>MAX</Text>
          </Pressable>
        </View>

        {/* Why a control is disabled, in words — a dead button with no reason is the worst case. */}
        {tooPoor && (
          <Text style={styles.warn}>
            You need at least ₮{min} to sit here. Deposit, or try a lower-stakes table.
          </Text>
        )}

        <Pressable
          disabled={tooPoor}
          onPress={() => {
            onConfirm(clamp(amount, min, ceiling));
            onClose();
          }}
          style={[styles.confirm, tooPoor && styles.confirmOff]}
        >
          <Text style={styles.confirmText}>
            {seatIndex === null ? `Add ₮${amount}` : `Sit with ₮${amount}`}
          </Text>
        </Pressable>

        <Pressable onPress={onClose} style={styles.cancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: space.lg,
    gap: space.md,
    borderTopWidth: 1,
    borderColor: theme.border,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.border,
  },
  title: { color: theme.text, fontSize: 17, fontWeight: '800' },
  amount: { color: theme.text, fontSize: 34, fontWeight: '900', textAlign: 'center' },
  range: { color: theme.dim, fontSize: 12, textAlign: 'center' },
  presets: { flexDirection: 'row', gap: space.sm },
  preset: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: theme.surface2,
    alignItems: 'center',
  },
  presetOff: { opacity: 0.35 },
  presetText: { color: theme.text, fontWeight: '700', fontSize: 12 },
  warn: { color: theme.danger, fontSize: 12, textAlign: 'center' },
  confirm: {
    paddingVertical: 15,
    borderRadius: radius.card,
    backgroundColor: theme.brand,
    alignItems: 'center',
  },
  confirmOff: { opacity: 0.4 },
  confirmText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  cancel: { alignItems: 'center', paddingVertical: 6 },
  cancelText: { color: theme.dim, fontSize: 14 },
});
