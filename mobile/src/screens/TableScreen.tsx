import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TableScreenProps } from '../navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { getToken } from '../session';
import { Sheet } from '../ui';
import { ChatIcon } from '../icons';
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

  /**
   * Buy-in budget, read from the server rather than from the snapshot.
   *
   * `snapshot.you` cannot gate the buy-in sheet. Poker builds it from the balance DIRECTORY, so it
   * is present before you sit. The other NINE rooms build it from the SEAT — `you: seat ? … : null`
   * — so it is null until you are already seated. Gating the sheet on it made sitting IMPOSSIBLE on
   * every non-poker game: tap Join, nothing opens, nothing explains why.
   *
   * /api/live/chips answers for an unseated player, which is exactly the question the sheet
   * needs answered.
   */
  const chips = useQuery({
    queryKey: ['live', 'chips'],
    queryFn: () => api.get<{ available: number }>('/api/live/chips'),
    enabled: token !== null,
    staleTime: 10_000,
  });

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
          <View style={styles.tableTools}>
            <Pressable onPress={() => setDesignOpen(true)} style={styles.toolButton}>
              <Text style={styles.toolText}>Table design</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {/*
        Chat is a FLOATING button, bottom-right, with an icon — the Mini App's own arrangement
        (frontend/src/pages/Table.tsx: `absolute bottom-[4.5rem] right-4`, size-12, rounded-full,
        MessageSquare, brand-coloured while open). It was an inline pill labelled "Chat" in a row
        under the felt, which is a different control in a different place.

        Unread count rides on the button rather than in the label, so the button stays a circle.
      */}
      <Pressable
        onPress={() => setChatOpen((o) => !o)}
        style={[styles.chatFab, chatOpen && styles.chatFabOn]}
        accessibilityLabel="Table chat"
      >
        <ChatIcon color={chatOpen ? '#fff' : theme.dim} size={20} />
        {messages.length > 0 && !chatOpen ? (
          <View style={styles.chatBadge}>
            <Text style={styles.chatBadgeText}>
              {messages.length > 99 ? '99+' : messages.length}
            </Text>
          </View>
        ) : null}
      </Pressable>

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

      {/* `snapshot.you` is null until the server's balance directory has warmed
          (see poker-room.ts buildSnapshot), not only when a balance is truly
          zero. BuyInSheet's `available` prop is a plain number with no way to
          say "unknown", so the sheet must not open on that null — opening it
          would coerce the unknown into a fabricated ₮0, disable the confirm
          button, and tell a funded player to go deposit. Deferring the open
          until `snapshot.you` exists costs nothing: a re-render fires the
          moment it warms, and `available` below is only ever shown while
          that condition holds. */}
      <BuyInSheet
        /*
         * Gated on the CHIPS query, not on `snapshot.you` — see the note by that query. The
         * original reasoning still holds and is preserved: never open against an unknown balance,
         * because `available: number` has no way to say "unknown" and a coerced 0 tells a funded
         * player to go and deposit. The change is only WHERE the known balance comes from, so that
         * a player who has not sat yet can still be told what they have.
         */
        open={buyInFor !== false && chips.data !== undefined}
        onClose={() => setBuyInFor(false)}
        min={snapshot.minBuyIn}
        max={snapshot.maxBuyIn}
        bigBlind={snapshot.bigBlind}
        // Only read while `open` above has proven `chips.data` exists; the 0 is unreachable and
        // exists solely to satisfy the non-nullable prop while the sheet is closed.
        available={chips.data?.available ?? 0}
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
  // Floating, bottom-right, clear of the ActionBar that appears on your turn.
  chatFab: {
    position: 'absolute',
    right: 16,
    bottom: 72,
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  chatFabOn: { backgroundColor: theme.brand, borderColor: theme.brand },
  chatBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: theme.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
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
