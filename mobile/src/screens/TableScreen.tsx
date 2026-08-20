import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TableScreenProps } from '../navigation';
import { getToken } from '../session';
import { space, theme } from '../theme';
import { useLiveTable } from '../table/useLiveTable';
import { PokerTable } from '../components/poker/PokerTable';
import { ActionBar } from '../components/poker/ActionBar';
import { feltFor } from '../components/games/registry';
import type { TableCommand, TableSnapshot } from '../lib/liveTable';

/**
 * TableScreen — the seam, now joined.
 *
 * The shell decided which table and can prove who you are; everything from here down is the game
 * side. The stub is replaced and the wiring it asked me to leave alone is untouched: the same props
 * from `RootStackParamList`, the same `getToken()`, the same theme tokens.
 *
 * A game whose felt is ported gets its felt; anything else says so rather than falling through to
 * a default. The Mini App spent a day rendering every game as poker because a lost registry did
 * exactly that, and nothing failed while it happened.
 */
export function TableScreen({ route }: TableScreenProps) {
  const { tableId } = route.params;
  const [token, setToken] = useState<string | null>(null);
  const [tokenChecked, setTokenChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getToken().then((t) => {
      if (cancelled) return;
      setToken(t);
      setTokenChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { snapshot, status, error, command } = useLiveTable(tableId, token);
  const Felt = feltFor(tableId);

  if (!tokenChecked) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.brand} />
      </View>
    );
  }

  if (!token) {
    return (
      <View style={styles.centre}>
        <Text style={styles.note}>
          Sign in to sit at a table. The table refuses an unauthenticated socket, so there is
          nothing to show until you do.
        </Text>
      </View>
    );
  }

  if (!snapshot) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.brand} />
        <Text style={styles.dim}>{status === 'ready' ? 'waiting for the table…' : status}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  const you = snapshot.seats.find((s) => s.isYou);
  // The server alone decides whose turn it is: `legal` is present only when it is yours.
  const yourTurn = Boolean(you) && snapshot.toActSeat === you?.index && snapshot.legal !== null;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {Felt ? (
          <Felt snapshot={snapshot} onCommand={command} />
        ) : (
          <Text style={styles.note}>
            {snapshot.name} has no felt on mobile yet. It is playable in the Mini App.
          </Text>
        )}
      </ScrollView>

      {yourTurn && snapshot.legal ? (
        <ActionBar
          legal={snapshot.legal}
          bet={you?.bet ?? 0}
          pot={snapshot.pot}
          onCommand={command}
        />
      ) : null}
    </View>
  );
}

/** The poker family shares one felt; this is it. */
export function HoldemFelt({
  snapshot,
  onCommand,
}: {
  snapshot: TableSnapshot;
  onCommand: (cmd: TableCommand) => void;
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
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: space.md, gap: space.md },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xl,
    backgroundColor: theme.bg,
  },
  dim: { color: theme.dim, fontSize: 12 },
  note: { color: theme.dim, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  error: { color: theme.danger, fontSize: 12 },
});
