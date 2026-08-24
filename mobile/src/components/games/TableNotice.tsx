import { StyleSheet, Text } from 'react-native';
import { radius, space, theme } from '../../theme';
import type { TableSnapshot } from '../../lib/liveTable';

/**
 * Why the table is not taking a bet right now.
 *
 * Ported from `frontend/src/components/games/TableNotice.tsx`. Every one of these games refuses to
 * deal below some number of seats. Until the rooms started saying so, a felt showed its chip
 * buttons anyway: you sat down at San Zhang alone, pressed Place Bet, and got "betting is closed" —
 * accurate, and no help at all. The room puts the reason in `snapshot.message` while it waits, and
 * a felt shows this instead of controls that cannot work.
 */
export function TableNotice({ snapshot }: { snapshot?: TableSnapshot | null }) {
  const phase = snapshot?.phase ?? 'WAITING';
  const text =
    snapshot?.message ??
    (phase === 'SHOWDOWN' ? 'Settling the round…' : 'Waiting for the next round…');

  return <Text style={styles.notice}>{text}</Text>;
}

const styles = StyleSheet.create({
  notice: {
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: space.lg,
    paddingVertical: 6,
    textAlign: 'center',
    fontSize: 12,
    color: theme.text,
    overflow: 'hidden',
  },
});
