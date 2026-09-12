import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { space, theme, weight } from '../../theme';
import type { LiveSeat } from '../../lib/liveTable';

/**
 * Who is at the table — the native twin of
 * `frontend/src/components/poker/PlayerListPanel.tsx`.
 *
 * ALL FOUR COLUMNS ARE REAL. The platform keeps no hand histories, so "hands"
 * and "result" could not be read from anywhere — but neither needs one. A seat
 * counts the hands it is dealt into, and records every chip brought to the
 * table (`boughtIn`, first buy-in plus each top-up). Result is `stack -
 * boughtIn`: what this session has cost or made them, here, right now.
 *
 * `boughtIn` accumulates rather than being set once, and that is the point:
 * without counting top-ups a player who rebought would show a bigger stack and
 * read as WINNING, having won none of it.
 *
 * SPECTATORS ARE A COUNT, NEVER A LIST. Who is watching is not the room's to
 * tell the people sitting at it — a name there turns a spectator into a
 * presence and hands a seated player information about who is studying them.
 *
 * A seat that has not played shows a DASH, not a zero: nothing has happened,
 * which is not the same as breaking even.
 */
export function PlayerListPanel({
  open,
  onClose,
  seats,
  spectators,
  tableId,
  openedAt,
  onPlayer,
}: {
  open: boolean;
  onClose: () => void;
  seats: LiveSeat[];
  /** Watchers with no seat. Undefined when the server has not said. */
  spectators?: number;
  tableId?: string;
  /** Epoch ms the table opened, from the server. */
  openedAt?: number;
  onPlayer?: (playerId: string) => void;
}) {
  const { t } = useTranslation();

  /**
   * How long the TABLE has been running, as HH:MM:SS.
   *
   * From the server's `openedAt`, not from when this panel opened — the age is
   * a fact about the table, and two players opening the list at different
   * moments must see the same number. Ticks only while open and only when
   * there is something to count from.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open || openedAt === undefined) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [open, openedAt]);

  const elapsed =
    openedAt === undefined
      ? null
      : (() => {
          const total = Math.max(0, Math.floor((now - openedAt) / 1000));
          const pad = (n: number) => String(n).padStart(2, '0');
          return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
        })();

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.tableId} numberOfLines={1}>
              {tableId ? `#${tableId}` : t('table.playerList')}
            </Text>
            {elapsed ? <Text style={styles.clock}>{elapsed}</Text> : null}
          </View>

          <View style={styles.headRow}>
            <Text style={[styles.headCell, styles.colName]}>{t('table.colNickname')}</Text>
            <Text style={[styles.headCell, styles.colNum]}>{t('table.colHands')}</Text>
            <Text style={[styles.headCell, styles.colNum]}>{t('table.colBuyin')}</Text>
            <Text style={[styles.headCell, styles.colNum]}>{t('table.colResult')}</Text>
          </View>

          <ScrollView bounces={false}>
            {seats.length === 0 ? (
              <Text style={styles.empty}>{t('table.noOtherPlayers')}</Text>
            ) : (
              seats.map((seat) => {
                const boughtIn = seat.boughtIn;
                const hands = seat.handsPlayed ?? 0;
                // No buy-in figure means an older server: the result is
                // unknowable, not zero.
                const result = boughtIn === undefined ? null : seat.stack - boughtIn;
                const unknown = result === null || hands === 0;
                return (
                  <Pressable
                    key={seat.playerId}
                    onPress={onPlayer ? () => onPlayer(seat.playerId) : undefined}
                    style={({ pressed }) => [styles.row, pressed && onPlayer && styles.rowPressed]}
                  >
                    <Text style={[styles.cell, styles.colName, styles.name]} numberOfLines={1}>
                      {seat.name}
                      {seat.isYou ? <Text style={styles.you}> {t('table.you')}</Text> : null}
                    </Text>
                    <Text style={[styles.cell, styles.colNum]}>{hands}</Text>
                    <Text style={[styles.cell, styles.colNum]}>
                      {boughtIn === undefined ? '—' : boughtIn}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.colNum,
                        styles.result,
                        unknown ? styles.dim : result >= 0 ? styles.up : styles.down,
                      ]}
                    >
                      {unknown ? '—' : `${result >= 0 ? '+' : ''}${result}`}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          {/* Hidden entirely when the server has not sent a count, rather than
              showing a confident zero. */}
          {spectators !== undefined ? (
            <Text style={styles.spectators}>
              {t('table.spectatorCount', { count: spectators })}
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { flex: 1, flexDirection: 'row', alignItems: 'flex-start' },
  panel: {
    width: '86%',
    maxWidth: 360,
    maxHeight: '88%',
    borderBottomRightRadius: 18,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingBottom: space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  tableId: { flex: 1, color: theme.brand, fontSize: 12, fontFamily: weight('600') },
  clock: { color: theme.brand, fontSize: 13, fontFamily: weight('700') },
  headRow: {
    flexDirection: 'row',
    paddingHorizontal: space.md,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  headCell: {
    color: theme.dim,
    fontSize: 9.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontFamily: weight('700'),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  rowPressed: { backgroundColor: theme.surface2 },
  cell: { color: theme.dim, fontSize: 12 },
  colName: { flex: 1 },
  colNum: { width: 56, textAlign: 'right' },
  name: { color: theme.text, fontFamily: weight('600') },
  you: { color: theme.dim, fontSize: 9 },
  result: { fontFamily: weight('700') },
  up: { color: theme.success },
  down: { color: theme.danger },
  dim: { color: theme.dim },
  empty: { color: theme.dim, fontSize: 12, textAlign: 'center', paddingVertical: space.xl },
  spectators: {
    color: theme.dim,
    fontSize: 12,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
});
