import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { TABLES_URL, PORTED_TABLES } from '../config';

/**
 * The lobby: what the table server is actually running.
 *
 * Reads the live table list rather than a hardcoded catalogue, so a game added on the server shows
 * up here without a client release. Tables whose felt has not been ported yet are listed but not
 * openable, and say so — the web app spent a day rendering every game as poker because a lost
 * registry silently fell through to a default, and a visible "not ported" is the cheap way to never
 * repeat that.
 */

interface TableRow {
  tableId: string;
  name: string;
  variant: string;
  seated: number;
  maxSeats: number;
  phase: string;
}

export interface LobbyScreenProps {
  onOpenTable: (tableId: string, name: string) => void;
}

export function LobbyScreen({ onOpenTable }: LobbyScreenProps) {
  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // The list lives at /api/live/tables and arrives wrapped in { tables: [...] } — checked
    // against the running server rather than assumed.
    fetch(`${TABLES_URL}/api/live/tables`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { tables: TableRow[] }) => {
        if (!cancelled) setTables(body.tables ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Name the address. On a phone "connection refused" almost always means the URL points at
        // the device itself rather than the dev machine — see config.ts.
        setError(`Could not reach ${TABLES_URL} — ${err instanceof Error ? err.message : err}`);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <View style={styles.centre}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (!tables) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color="#f5c451" />
        <Text style={styles.dim}>Loading tables…</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={tables}
      keyExtractor={(t) => t.tableId}
      ListHeaderComponent={
        <Text style={styles.heading}>{tables.length} tables open</Text>
      }
      renderItem={({ item }) => {
        const ported = PORTED_TABLES.has(item.tableId);
        return (
          <Pressable
            disabled={!ported}
            onPress={() => onOpenTable(item.tableId, item.name)}
            style={[styles.row, !ported && styles.rowDisabled]}
          >
            <View style={styles.rowMain}>
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.dim}>
                {item.variant} · {item.seated}/{item.maxSeats} seated · {item.phase}
              </Text>
            </View>
            <Text style={ported ? styles.open : styles.notPorted}>
              {ported ? 'OPEN' : 'no felt yet'}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#0b0b17' },
  listContent: { padding: 16, gap: 10 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#0b0b17', padding: 24 },
  heading: { color: '#f5c451', fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#242445',
    backgroundColor: '#14142a',
  },
  rowDisabled: { opacity: 0.45 },
  rowMain: { flex: 1, gap: 3 },
  rowName: { color: '#fff', fontWeight: '700', fontSize: 15 },
  dim: { color: '#8b8bb0', fontSize: 12 },
  open: { color: '#3fd07a', fontWeight: '800', fontSize: 12 },
  notPorted: { color: '#8b8bb0', fontSize: 11, fontStyle: 'italic' },
  error: { color: '#f85677', textAlign: 'center' },
});
