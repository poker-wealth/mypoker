import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { LegalActions, TableCommand } from '../../lib/liveTable';

/**
 * What you may do, and only what you may do.
 *
 * Ported from `frontend/src/components/poker/ActionBar.tsx`, with one deliberate difference: the
 * web version derives the legal bounds itself (`state.toCall === 0`, `hero.bet + hero.stack`),
 * whereas this reads `snapshot.legal` — the bounds the SERVER sent for this exact turn.
 *
 * That is the safer half of the same contract. The server re-checks every command regardless, so a
 * client that computes its own limits can only ever disagree with it: offer a raise it will refuse,
 * or hide one it would have allowed. Reading `legal` means the buttons say what the table will
 * actually accept.
 */

export interface ActionBarProps {
  legal: LegalActions;
  /** Chips already in front of this seat this street — the floor a raise-to builds on. */
  bet: number;
  pot: number;
  onCommand: (cmd: TableCommand) => void;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(n, hi));

export function ActionBar({ legal, bet, pot, onCommand }: ActionBarProps) {
  const { t } = useTranslation();
  const minRaiseTo = legal.minRaiseTo ?? 0;
  const maxRaiseTo = legal.maxRaiseTo ?? 0;
  const canRaise = legal.minRaiseTo !== null && maxRaiseTo > minRaiseTo;

  const [raiseTo, setRaiseTo] = useState(minRaiseTo);
  const amount = useMemo(
    () => clamp(raiseTo || minRaiseTo, minRaiseTo, maxRaiseTo),
    [raiseTo, minRaiseTo, maxRaiseTo],
  );

  /** Pot-fraction sizing, clamped to what the server said is legal. */
  const sizeTo = (fraction: number): void => {
    setRaiseTo(clamp(bet + Math.round(pot * fraction), minRaiseTo, maxRaiseTo));
  };

  return (
    <View style={styles.bar}>
      {canRaise && (
        <View style={styles.sizing}>
          {([
            ['table.halfPot', 0.5],
            ['table.threeQuarterPot', 0.75],
            ['table.pot', 1],
          ] as const).map(([key, f]) => (
            <Pressable key={key} onPress={() => sizeTo(f)} style={styles.chip}>
              <Text style={styles.chipText}>{t(key)}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setRaiseTo(maxRaiseTo)} style={styles.chip}>
            <Text style={styles.chipText}>{t('table.allIn')}</Text>
          </Pressable>
          <Text style={styles.amount}>₮{amount}</Text>
        </View>
      )}

      <View style={styles.row}>
        {legal.canFold && (
          <Pressable
            onPress={() => onCommand({ kind: 'act', action: { type: 'fold' } })}
            style={[styles.action, styles.fold]}
          >
            <Text style={styles.actionText}>{t('table.fold')}</Text>
          </Pressable>
        )}

        {legal.canCheck ? (
          <Pressable
            onPress={() => onCommand({ kind: 'act', action: { type: 'check' } })}
            style={[styles.action, styles.call]}
          >
            <Text style={styles.actionText}>{t('table.check')}</Text>
          </Pressable>
        ) : (
          legal.callAmount !== null && (
            <Pressable
              onPress={() => onCommand({ kind: 'act', action: { type: 'call' } })}
              style={[styles.action, styles.call]}
            >
              <Text style={styles.actionText}>{t('table.call', { amount: `₮${legal.callAmount}` })}</Text>
            </Pressable>
          )
        )}

        {canRaise && (
          <Pressable
            onPress={() => onCommand({ kind: 'act', action: { type: 'raise', amount } })}
            style={[styles.action, styles.raise]}
          >
            <Text style={styles.actionText}>{t('table.raise')} ₮{amount}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#242445',
    backgroundColor: '#14142a',
  },
  sizing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#1e1b4b',
    borderWidth: 1,
    borderColor: '#333366',
  },
  chipText: { color: '#c7c7e6', fontSize: 11, fontWeight: '700' },
  amount: { color: '#f5c451', fontWeight: '800', marginLeft: 'auto' },
  row: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  fold: { backgroundColor: '#3b1e2b' },
  call: { backgroundColor: '#1e3b32' },
  raise: { backgroundColor: '#6366f1' },
  actionText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
