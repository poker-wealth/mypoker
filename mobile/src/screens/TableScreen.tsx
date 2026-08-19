import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLiveTable } from '../hooks/useLiveTable';

/**
 * A table, before any felt exists for it.
 *
 * This is deliberately the RAW snapshot rather than a half-drawn game. The transport is the piece
 * being proved right now — handshake, MAC'd frames, live snapshots — and a felt drawn on top would
 * hide whether that works. Each game's felt replaces this screen one at a time, and the lobby only
 * opens the ones that have one.
 */

export interface TableScreenProps {
  tableId: string;
  token: string | null;
}

export function TableScreen({ tableId, token }: TableScreenProps) {
  const { snapshot, status, error } = useLiveTable(tableId, token);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.statusRow}>
        <Text style={styles.label}>connection</Text>
        <Text style={[styles.value, status === 'ready' ? styles.ok : styles.pending]}>{status}</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {!token && (
        <Text style={styles.note}>
          No session token yet — sign-in is Samuel's half of the app. Pass one in to open a table.
        </Text>
      )}

      {snapshot ? (
        <>
          <View style={styles.statusRow}>
            <Text style={styles.label}>{snapshot.name}</Text>
            <Text style={styles.value}>
              {snapshot.phase}
              {snapshot.stage ? ` · ${snapshot.stage}` : ''}
            </Text>
          </View>

          <Text style={styles.section}>
            seats {snapshot.seats.filter((s) => s.playerId).length}/{snapshot.maxSeats} · pot ₮
            {snapshot.pot}
          </Text>

          {snapshot.message && <Text style={styles.note}>{snapshot.message}</Text>}

          {snapshot.seats
            .filter((s) => s.playerId)
            .map((s) => (
              <View key={s.index} style={styles.seat}>
                <Text style={styles.seatName}>
                  {s.isDealer ? '👑 ' : ''}
                  {s.name}
                  {s.isYou ? ' (you)' : ''}
                </Text>
                <Text style={styles.dim}>
                  ₮{s.stack}
                  {s.bet > 0 ? ` · bet ₮${s.bet}` : ''}
                </Text>
              </View>
            ))}

          {/* The proof the transport works: real, verified, per-viewer state off the wire. */}
          <Text style={styles.section}>raw snapshot</Text>
          <Text style={styles.json}>{JSON.stringify(snapshot, null, 2)}</Text>
        </>
      ) : (
        <Text style={styles.dim}>waiting for the first snapshot…</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0b17' },
  content: { padding: 16, gap: 10 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: '#8b8bb0', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  value: { color: '#fff', fontWeight: '700' },
  ok: { color: '#3fd07a' },
  pending: { color: '#f5c451' },
  section: { color: '#f5c451', fontWeight: '800', marginTop: 12, fontSize: 12, letterSpacing: 1 },
  seat: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#14142a',
    borderWidth: 1,
    borderColor: '#242445',
  },
  seatName: { color: '#fff', fontWeight: '600' },
  dim: { color: '#8b8bb0', fontSize: 12 },
  note: { color: '#8b8bb0', fontSize: 12, fontStyle: 'italic' },
  error: { color: '#f85677' },
  json: { color: '#6f6f95', fontFamily: 'monospace', fontSize: 10 },
});
