import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLiveTable } from '../hooks/useLiveTable';
import { PokerTable } from '../components/poker/PokerTable';
import { ActionBar } from '../components/poker/ActionBar';
import { feltFor } from '../components/games/registry';

/**
 * A table.
 *
 * Games with a felt ported get their felt; the rest still show the raw snapshot, which is how the
 * transport was proved and stays useful while the remaining games are ported. The lobby only opens
 * a table that has a felt, so the raw view is a safety net rather than something players meet.
 */

export interface TableScreenProps {
  tableId: string;
  token: string | null;
}

export function TableScreen({ tableId, token }: TableScreenProps) {
  const { snapshot, status, error, command } = useLiveTable(tableId, token);
  const Felt = feltFor(tableId);

  if (!token) {
    return (
      <View style={styles.centre}>
        <Text style={styles.note}>
          No session token yet. Sign-in is the app shell's half — pass one in and this table opens.
        </Text>
      </View>
    );
  }

  if (!snapshot) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color="#f5c451" />
        <Text style={styles.dim}>{status === 'ready' ? 'waiting for the table…' : status}</Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    );
  }

  const you = snapshot.seats.find((s) => s.isYou);
  const yourTurn = Boolean(you) && snapshot.toActSeat === you?.index && snapshot.legal !== null;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {error && <Text style={styles.error}>{error}</Text>}

        {Felt ? (
          <Felt snapshot={snapshot} onCommand={command} />
        ) : (
          <>
            <Text style={styles.note}>No felt ported for {tableId} yet — raw snapshot:</Text>
            <Text style={styles.json}>{JSON.stringify(snapshot, null, 2)}</Text>
          </>
        )}
      </ScrollView>

      {/* Only when the server says it is your turn, and only with the bounds it sent. */}
      {yourTurn && snapshot.legal && (
        <ActionBar
          legal={snapshot.legal}
          bet={you?.bet ?? 0}
          pot={snapshot.pot}
          onCommand={command}
        />
      )}
    </View>
  );
}

/** The poker family shares one felt; this is it. */
export function HoldemFelt({
  snapshot,
  onCommand,
}: {
  snapshot: import('../lib/liveTable').TableSnapshot;
  onCommand: (cmd: import('../lib/liveTable').TableCommand) => void;
}) {
  const seated = snapshot.seats.some((s) => s.isYou);
  return (
    <PokerTable
      snapshot={snapshot}
      {...(seated
        ? {}
        : {
            onSit: (seatIndex: number) =>
              onCommand({ kind: 'sit', seat: seatIndex, buyIn: snapshot.minBuyIn }),
          })}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0b17' },
  content: { padding: 12, gap: 10 },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: '#0b0b17',
  },
  dim: { color: '#8b8bb0', fontSize: 12 },
  note: { color: '#8b8bb0', fontSize: 12, fontStyle: 'italic', textAlign: 'center' },
  error: { color: '#f85677', fontSize: 12 },
  json: { color: '#6f6f95', fontFamily: 'monospace', fontSize: 10 },
});
