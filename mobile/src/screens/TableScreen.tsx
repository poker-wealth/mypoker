import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TableScreenProps } from '../navigation';
import { getToken } from '../session';
import { Sheet } from '../ui';
import { radius, space, theme } from '../theme';
import { useLiveTable } from '../table/useLiveTable';
import { ActionBar } from '../components/poker/ActionBar';
import { feltFor } from '../components/games/registry';
import { HoldemFelt } from '../components/games/HoldemFelt';
import { BuyInSheet } from '../components/poker/BuyInSheet';
import { JackpotBurst } from '../components/poker/JackpotBurst';
import { TableDesignSheet } from '../components/poker/TableDesignSheet';
import { ChatBox } from '../components/poker/ChatBox';
import { ChallengeModal } from '../components/poker/ChallengeModal';
import { useTableChat } from '../table/useTableChat';
import { useChallengePrompt } from '../table/useChallengePrompt';

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

  const { snapshot, status, error, command, socket } = useLiveTable(tableId, token);
  const { messages, sendChat } = useTableChat(socket);
  const { challengerId, clear: clearChallenge } = useChallengePrompt(socket);
  const [chatOpen, setChatOpen] = useState(false);
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

        <View style={styles.tableTools}>
          <Pressable onPress={() => setChatOpen(true)} style={styles.toolButton}>
            <Text style={styles.toolText}>
              Chat{messages.length > 0 ? ` (${messages.length})` : ''}
            </Text>
          </Pressable>
          {designable ? (
            <Pressable onPress={() => setDesignOpen(true)} style={styles.toolButton}>
              <Text style={styles.toolText}>Table design</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <TableDesignSheet open={designOpen} onClose={() => setDesignOpen(false)} />

      <Sheet open={chatOpen} onClose={() => setChatOpen(false)} title="Table chat">
        <View style={styles.chatHost}>
          <ChatBox
            messages={messages}
            onSend={sendChat}
            {...(snapshot.you ? { myPlayerId: snapshot.you.playerId } : {})}
            // Chat is a seated privilege; a spectator watching a table does not get to talk at it.
            disabled={!snapshot.you || snapshot.yourSeat === null}
            placeholder={snapshot.yourSeat === null ? 'Take a seat to chat' : 'Say something...'}
          />
        </View>
      </Sheet>

      {/* The bot check. Arrives addressed to this viewer only, and cannot be dismissed — see
          ChallengeModal. Answering clears it; the server scores how long it took. */}
      <ChallengeModal
        open={challengerId !== null}
        challengerId={challengerId ?? ''}
        onAnswer={(passed, responseMs) => {
          command({ kind: 'answer_challenge', passed, responseMs });
          clearChallenge();
        }}
      />

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
  tableTools: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  toolButton: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: space.lg,
    paddingVertical: 7,
  },
  toolText: { color: theme.dim, fontSize: 12, fontWeight: '600' },
  // The sheet sizes to its content, and ChatBox is `flex: 1` — without a height it collapses to
  // nothing and the composer sits under the title with no log above it.
  chatHost: { height: 380 },
  dim: { color: theme.dim, fontSize: 12 },
  note: { color: theme.dim, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  error: { color: theme.danger, fontSize: 12 },
});
