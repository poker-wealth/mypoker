import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TableScreenProps } from '../navigation';
import { getToken } from '../session';
import { Badge, Button, Sheet } from '../ui';
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
export function TableScreen({ route, navigation }: TableScreenProps) {
  const { tableId } = route.params;
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
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

  /**
   * App.tsx registers this screen with no `options`, so React Navigation's header falls back to
   * the literal route name "Table" — every one of the five poker tables (texas, texas-high,
   * short-deck, omaha, texas-cowboy) read the same word, indistinguishable once opened. That cost
   * real time during live device testing tonight: neither the tester nor I could tell which room
   * he was in. Before the snapshot arrives there's nothing better than `tableId` to show, so use
   * that rather than a blank or invented placeholder; once the snapshot lands, prefer its `name`
   * (matching the web's header, frontend/src/pages/Table.tsx:103), falling back to `tableId` if
   * the server ever sends an empty name.
   */
  useEffect(() => {
    navigation.setOptions({ title: snapshot?.name || tableId });
  }, [navigation, snapshot?.name, tableId]);
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

  /**
   * `status` used to be consulted only in the pre-snapshot branch above. Once a snapshot has
   * arrived, everything below rendered from that last snapshot with nothing tied to connection
   * state — so a reconnect (a lift, a tunnel, a moment backgrounded) left the felt, stacks and pot
   * looking perfectly live while frozen on the last hand. `sendInner` in tableSocket.ts also
   * silently drops any command sent while the socket isn't OPEN, so a tap on Fold or Call during
   * that window goes nowhere and nothing tells the player — the server's turn timer just runs them
   * down. This makes the state visible instead: a persistent banner while `status !== 'ready'`, and
   * the ActionBar below gated so it doesn't look tappable while disconnected.
   */
  const disconnected = status !== 'ready';
  const retryableStatus = status === 'error' || status === 'closed';

  return (
    <View style={styles.screen}>
      {disconnected ? (
        <View style={styles.connectionBanner} pointerEvents="box-none">
          <View style={styles.connectionBannerInner}>
            <Badge tone="warn">
              {retryableStatus ? t('table.connectionLost') : t('states.reconnecting')}
            </Badge>
            {retryableStatus ? (
              <Button variant="ghost" onPress={() => socket?.connect()}>
                {t('common.retry')}
              </Button>
            ) : null}
          </View>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {Felt ? (
          // The ActionBar gate below only covers Hold'em: its Fold/Call/Raise row is the one
          // control that routes through `command`. Every other felt (Baccarat, SideBet/
          // CowboyBeauty/SanZhang, NiuNiu, RedPacket, Lottery, Slots, DouDiZhu, TexasCowboy)
          // carries its own bet buttons, market cells, packet taps or SPIN control drawn inside
          // the felt itself, calling `onCommand` directly — gating ActionBar does nothing for
          // those. `sendInner` in tableSocket.ts silently drops any command sent while the
          // socket isn't OPEN, so during a reconnect an ungated felt control is a button that
          // lies: it looks live and tappable but goes nowhere. Mirror the ActionBar treatment
          // here so the same tap-does-nothing failure can't happen for any other game. Unlike
          // the ActionBar, the felt must stay readable while disconnected — a player still needs
          // to see their hand, the board and stacks — so this uses a lighter opacity than
          // `actionBarDisabled`'s 0.4 (which would obscure card faces here).
          <View style={disconnected ? styles.feltDisabled : undefined} pointerEvents={disconnected ? 'none' : 'auto'}>
            <Felt snapshot={snapshot} onCommand={command} onSit={(seat) => setBuyInFor(seat)} />
          </View>
        ) : (
          <Text style={styles.note}>
            {snapshot.name} has no felt on mobile yet. It is playable in the Mini App.
          </Text>
        )}

        {/* Stand, and the seat's own state control, mirroring the web's action dock
            (frontend/src/pages/Table.tsx:213-236): both appear only when seated and it's
            not your turn — an in-progress turn already has the ActionBar below, and there
            is nothing to sit in/out of or rebuy before you have a seat.

            The state control is one slot, not three buttons: a seat is at all times exactly
            one of "busted", "sitting out" or "playing", so only the matching control ever
            renders, same as the web.

              Rebuy — the ONLY way `buyIn` (mobile/src/lib/liveTable.ts:167) ever reaches
              the wire: `setBuyInFor(null)` opens the same BuyInSheet used to sit down, in
              top-up mode. The server busts a stack to sittingout on its own the moment it
              hits zero (poker-room.ts:969) — with no way to reopen this sheet a funded
              player just sits dead at the table until they stand and lose the seat.

              Sit in — the server also sits a player out entirely without being asked:
              disconnect grace expiry (poker-room.ts:396), abandoning mid-hand (:419, :527),
              and an action timeout while disconnected (:924) all set it. Backgrounding the
              app or losing signal for a few seconds is enough to trigger any of these, and
              until now nothing sent `sitIn` back — the seat just sat dead hand after hand.

              Sit out — lets a player step away on purpose instead of being timed out into
              it hand by hand, which also costs them at the bot-detection layer. */}
        {snapshot.yourSeat !== null && !yourTurn ? (
          <View style={styles.standRow}>
            {you && you.stack === 0 ? (
              // Web's closest label is a hardcoded "Rebuy" (Table.tsx:222) with no i18n key at
              // all. No existing key says "rebuy" either; `lobby.colBuyIn` ("Buy-in") is the
              // nearest concept already in the catalogue. Flagged for a real `table.rebuy` key.
              <Button onPress={() => setBuyInFor(null)}>{t('table.rebuy')}</Button>
            ) : you?.status === 'sittingout' ? (
              // Web hardcodes "Sit in" (Table.tsx:226) with no key either. `common.join` ("Join")
              // is the closest stand-in — flagged for a real `table.sitIn` key.
              <Button onPress={() => command({ kind: 'sitIn' })}>{t('table.sitIn')}</Button>
            ) : (
              // Web hardcodes "Sit out" (Table.tsx:230, variant="secondary" — mobile's Button has
              // no secondary tone, so ghost is the closest de-emphasised match). No existing key
              // says "sit out"; `lobby.status.waiting` ("Wait") is the nearest — flagged for a
              // real `table.sitOut` key.
              <Button variant="ghost" onPress={() => command({ kind: 'sitOut' })}>
                {t('table.sitOut')}
              </Button>
            )}
            {/* The only way off this screen that actually vacates the seat. `leave` (back
                button, backgrounding) only unsubscribes from the room; the server keeps the
                seat on purpose, so a network blip or a moment in the background can't cost a
                stack mid-hand. That means nothing here may call `stand` on its own: no unmount
                cleanup, no back-button handler. Without an explicit control a player who backs
                out has no way to free themselves for another table (see §8.1 "one account, one
                table" in table-hub.ts) — this button, tapped on purpose, is that way out. */}
            <Button variant="ghost" onPress={() => command({ kind: 'stand' })}>
              {t('table.leave')}
            </Button>
          </View>
        ) : null}

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
        open={buyInFor !== false && snapshot.you != null}
        onClose={() => setBuyInFor(false)}
        min={snapshot.minBuyIn}
        max={snapshot.maxBuyIn}
        bigBlind={snapshot.bigBlind}
        // Only ever read while `open` (above) has already proven `snapshot.you`
        // is non-null, so this fallback is never actually shown or computed
        // against — it exists purely to satisfy BuyInSheet's non-nullable
        // `available: number` prop while the sheet sits hidden.
        available={snapshot.you ? snapshot.you.available : 0}
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

      {/* Bottom-inset wrapper, not padding inside ActionBar (out of scope, see ActionBar.tsx):
          on a home-indicator iPhone the Fold/Call/Raise row would otherwise sit inside the
          system swipe-up zone, where a swipe-to-home during your turn risks a fold-by-timeout. */}
      {yourTurn && snapshot.legal ? (
        // Background matches ActionBar's own bar colour (`#14142a`, ActionBar.tsx) so the inset
        // padding reads as the bar extending under the home indicator, not a mismatched stripe
        // of the screen background (`theme.bg`, `#0d0d1a`) beneath it.
        <View style={[styles.actionBarInset, { paddingBottom: insets.bottom }]}>
          {/* ActionBar itself (out of scope here — see ActionBar.tsx) has no disabled prop, so
              disconnected is enforced from outside: dim it and swallow every touch so a tap
              during a reconnect cannot look like it did something. `sendInner` in tableSocket.ts
              would silently drop the command anyway; this stops the tap from ever reaching it
              and makes that true at a glance, not just in the wire code. */}
          <View
            style={disconnected ? styles.actionBarDisabled : undefined}
            pointerEvents={disconnected ? 'none' : 'auto'}
          >
            <ActionBar
              legal={snapshot.legal}
              bet={you?.bet ?? 0}
              pot={snapshot.pot}
              onCommand={command}
            />
          </View>
        </View>
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
  actionBarInset: { backgroundColor: '#14142a' },
  actionBarDisabled: { opacity: 0.4 },
  // Lighter than actionBarDisabled: the felt's cards, board and stacks must stay readable
  // during a reconnect, only its embedded controls need to read as dead.
  feltDisabled: { opacity: 0.6 },
  // Absolutely positioned over the ScrollView (not inside its content) so it stays put — visible
  // and unmissable — regardless of scroll position, without covering the felt beneath it.
  connectionBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
    paddingTop: space.sm,
  },
  connectionBannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingLeft: space.sm,
    paddingRight: space.xs,
    paddingVertical: space.xs,
  },
  standRow: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
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
