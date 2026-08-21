import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TableScreenProps } from '../navigation';
import { getToken } from '../session';
import { radius, space, theme } from '../theme';
import { useLiveTable } from '../table/useLiveTable';
import { ActionBar } from '../components/poker/ActionBar';
import { feltFor } from '../components/games/registry';
import { HoldemFelt } from '../components/games/HoldemFelt';
import { BuyInSheet } from '../components/poker/BuyInSheet';
import { JackpotBurst } from '../components/poker/JackpotBurst';
import { TableDesignSheet } from '../components/poker/TableDesignSheet';

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
  const [buyInFor, setBuyInFor] = useState<number | null | false>(false);
  /** Which jackpot this viewer has already watched, so a re-render cannot replay it. */
  const [jackpotSeen, setJackpotSeen] = useState<string | null>(null);
  const [designOpen, setDesignOpen] = useState(false);
  const Felt = feltFor(tableId);
  /**
   * Only the poker family draws the configurable table, so only it offers the picker. Derived from
   * the registry rather than a second list of table ids — one of those would eventually disagree
   * with the other, and the disagreement would show up as a control that changes nothing.
   */
  const designable = Felt === HoldemFelt;

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
          <Felt snapshot={snapshot} onCommand={command} onSit={(seat) => setBuyInFor(seat)} />
        ) : (
          <Text style={styles.note}>
            {snapshot.name} has no felt on mobile yet. It is playable in the Mini App.
          </Text>
        )}

        {designable ? (
          <Pressable onPress={() => setDesignOpen(true)} style={styles.designButton}>
            <Text style={styles.designText}>Table design</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <TableDesignSheet open={designOpen} onClose={() => setDesignOpen(false)} />

      <BuyInSheet
        open={buyInFor !== false}
        onClose={() => setBuyInFor(false)}
        min={snapshot.minBuyIn}
        max={snapshot.maxBuyIn}
        bigBlind={snapshot.bigBlind}
        available={snapshot.you?.available ?? 0}
        seatIndex={typeof buyInFor === 'number' ? buyInFor : null}
        onConfirm={(amount) => {
          if (typeof buyInFor === 'number') {
            command({ kind: 'sit', seat: buyInFor, buyIn: amount });
          } else {
            command({ kind: 'buyIn', amount });
          }
        }}
      />

      {/* A jackpot is table news: every viewer sees it, for as long as the server says. */}
      {snapshot.jackpot && snapshot.jackpot.roundId !== jackpotSeen ? (
        <JackpotBurst
          tier={snapshot.jackpot.tier}
          playerName={snapshot.jackpot.playerName}
          amount={snapshot.jackpot.amount}
          animationMs={snapshot.jackpot.animationMs}
          onDone={() => setJackpotSeen(snapshot.jackpot?.roundId ?? null)}
        />
      ) : null}

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
  designButton: {
    alignSelf: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: space.lg,
    paddingVertical: 7,
  },
  designText: { color: theme.dim, fontSize: 12, fontWeight: '600' },
  dim: { color: theme.dim, fontSize: 12 },
  note: { color: theme.dim, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  error: { color: theme.danger, fontSize: 12 },
});
