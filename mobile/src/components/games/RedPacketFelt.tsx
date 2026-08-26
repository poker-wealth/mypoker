import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { radius, space, theme } from '../../theme';
import type { LiveSeat, TableCommand, TableSnapshot } from '../../lib/liveTable';

/**
 * RED PACKET MINE SWEEPING — a room, not a form.
 *
 * Ported from `frontend/src/components/games/RedPacketFelt.tsx`. A wall of numbered packets hangs
 * in the middle, the players line the two sides with what they grabbed, and the banker sits at the
 * foot of the table. Claim a packet with your stake; when the clock runs out the mines are revealed
 * and the ones who took them pay the ones who didn't.
 *
 * Every number here is the server's. The felt shows the picks (already public — the whole table
 * watches you claim), and only ever learns which packets were mined after the round reveals them.
 *
 * The one deliberate difference from the web felt: the two sweeper columns are hidden on web below
 * `sm`, which on a phone means always. A phone is the only screen this app has, so the players go
 * in a strip under the grid instead of being dropped — you cannot see who you are playing against
 * otherwise.
 */

/** Mirrors the `gameState` built in game-server/src/live/red-packet-room.ts. */
interface RedPacketRound {
  size: number;
  mineCount: number;
  /** Present only once the round has revealed. */
  mines?: number[];
  seats: Array<{ index: number; cell?: number; net?: number }>;
}

const CHIPS = [50, 100, 500, 1_000];

export function RedPacketFelt({
  snapshot,
  onCommand,
  onSit,
}: {
  snapshot: TableSnapshot;
  onCommand: (cmd: TableCommand) => void;
  /**
   * Taking a seat opens the buy-in sheet — it does NOT commit one.
   *
   * Every one of these felts used to send { kind: 'sit', buyIn: snapshot.minBuyIn } straight
   * from the button, so a tap moved money at an amount the player was never shown and never
   * chose. The poker felt has always gone through BuyInSheet; the other eight did not. An audit
   * found all eight.
   *
   * Required, not optional: a felt that cannot open the sheet must not fall back to spending.
   */
  onSit: (seatIndex: number) => void;
}) {
  const [betAmount, setBetAmount] = useState(100);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const phase = snapshot.phase;
  const seats = snapshot.seats;
  const round = snapshot.gameState as RedPacketRound | undefined;
  const you = seats.find((s) => s.isYou);
  const banker = seats.find((s) => s.playerId && s.isDealer);
  const players = seats.filter((s) => s.playerId && !s.isDealer);

  const size = round?.size ?? 25;
  const mines = round?.mines;
  const stateOf = (index: number) => round?.seats.find((s) => s.index === index);
  const yourCell = you ? stateOf(you.index)?.cell : undefined;
  const claimedBy = new Map<number, LiveSeat>();
  for (const s of players) {
    const cell = stateOf(s.index)?.cell;
    if (cell !== undefined) claimedBy.set(cell, s);
  }

  const secondsLeft = snapshot.actionDeadline
    ? Math.max(0, Math.ceil((snapshot.actionDeadline - now) / 1_000))
    : null;

  const sitDown = (): void => {
    const free = seats.find((s) => !s.playerId);
    onSit(free?.index ?? 0);
  };

  const canClaim = Boolean(you) && phase === 'IN_HAND' && yourCell === undefined;
  const claim = (cell: number): void => {
    if (!canClaim) return;
    onCommand({ kind: 'act', action: { type: String(cell), amount: betAmount } });
  };

  const columns = Math.ceil(Math.sqrt(size));

  return (
    <View style={styles.wrap}>
      {/* The banner across the top: what is in the middle and how many mines are in it */}
      <View style={styles.banner}>
        <Pill label="POT" value={`₮${snapshot.pot}`} />
        <Pill label="PACKETS" value={String(size)} />
        <Pill label="💣 MINES" value={round?.mineCount !== undefined ? String(round.mineCount) : '—'} />
      </View>

      <View style={styles.centre}>
        {secondsLeft !== null && phase === 'IN_HAND' ? (
          <Text style={styles.countdown}>COUNTDOWN · {secondsLeft}</Text>
        ) : (
          <Text style={styles.countdownDim}>{phase === 'SHOWDOWN' ? 'REVEALED' : 'WAITING'}</Text>
        )}
        {phase === 'WAITING' && snapshot.message ? (
          <Text style={styles.waitingWhy}>{snapshot.message}</Text>
        ) : null}
      </View>

      {/* The packets */}
      <View style={[styles.grid, { maxWidth: columns * 50 }]}>
        {Array.from({ length: size }, (_, cell) => {
          const owner = claimedBy.get(cell);
          const mined = mines?.includes(cell);
          const yours = yourCell === cell;
          return (
            <Pressable
              key={cell}
              onPress={() => claim(cell)}
              disabled={!canClaim}
              style={[
                styles.packet,
                mined ? styles.packetMined : yours ? styles.packetYours : owner ? styles.packetTaken : null,
              ]}
            >
              <Text style={styles.packetGlyph}>{mined ? '💣' : '🧧'}</Text>
              <Text style={[styles.packetNum, yours && styles.packetNumYours]}>{cell}</Text>
              {owner && !mined ? (
                <Text style={styles.packetOwner} numberOfLines={1}>
                  {owner.name.slice(0, 6)}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {/* The sweepers. On web these are two columns flanking the grid; a phone has no room for
          that, so they run along the bottom instead of disappearing. */}
      {players.length > 0 ? (
        <View>
          <Text style={styles.sweepersTitle}>SWEEPERS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sweepers}>
            {players.map((p) => {
              const info = stateOf(p.index);
              return (
                <View key={p.index} style={[styles.sweeper, p.isYou && styles.sweeperYou]}>
                  <Text style={styles.sweeperName} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text style={styles.sweeperStack}>₮{p.stack}</Text>
                  {info?.cell !== undefined ? (
                    <Text style={styles.sweeperCell}>#{info.cell}</Text>
                  ) : null}
                  {info?.net !== undefined && info.net !== 0 ? (
                    <Text style={[styles.sweeperNet, { color: info.net > 0 ? theme.success : theme.danger }]}>
                      {info.net > 0 ? '+' : ''}
                      {info.net}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* The banker, and the way in */}
      <View style={styles.banker}>
        <Text style={styles.bankerTitle}>👑 BANKER</Text>
        <Text style={styles.bankerName} numberOfLines={1}>
          {banker?.name ?? '—'}
        </Text>
        {banker ? <Text style={styles.bankerStack}>₮{banker.stack}</Text> : null}
      </View>

      {!you ? (
        <Pressable onPress={sitDown} style={styles.join}>
          <Text style={styles.joinText}>JOIN GAME</Text>
        </Pressable>
      ) : (
        <View style={styles.controls}>
          <View style={styles.chips}>
            {CHIPS.map((amt) => (
              <Pressable
                key={amt}
                onPress={() => setBetAmount(amt)}
                disabled={yourCell !== undefined}
                style={[
                  styles.chip,
                  betAmount === amt && styles.chipOn,
                  yourCell !== undefined && styles.chipLocked,
                ]}
              >
                <Text style={[styles.chipText, betAmount === amt && styles.chipTextOn]}>{amt}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>
            {yourCell !== undefined
              ? `You hold packet #${yourCell}`
              : phase === 'IN_HAND'
                ? `Tap a packet to claim it for ₮${betAmount}`
                : 'Waiting for the next round'}
          </Text>
          <Text style={styles.balance}>Balance ₮{you.stack}</Text>
        </View>
      )}
    </View>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillLabel}>
        {label} <Text style={styles.pillValue}>{value}</Text>
      </Text>
    </View>
  );
}

/**
 * The felt is its own scene: deep red, not the app's near-black.
 *
 * Web paints this as a radial gradient (#7c1636 centre out to #26030f). React Native has no
 * gradient without a library, and adding one for a background is not worth the dependency, so this
 * is the flat mid-tone of that gradient.
 */
const RED_DEEP = '#4a0d22';
const RED_DARK = '#26030f';

const styles = StyleSheet.create({
  wrap: {
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: RED_DEEP,
    alignItems: 'center',
  },
  banner: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, flexWrap: 'wrap' },
  pill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.4)',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: space.md,
    paddingVertical: 4,
  },
  pillLabel: { color: '#fde68a', fontSize: 11, fontWeight: '800' },
  pillValue: { color: '#fff' },
  centre: { alignItems: 'center' },
  countdown: { color: '#fde68a', fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  countdownDim: { color: 'rgba(253,230,138,0.7)', fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  waitingWhy: { marginTop: 4, color: 'rgba(254,205,211,0.8)', fontSize: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  packet: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(190,18,60,0.6)',
    backgroundColor: '#881337',
    alignItems: 'center',
    justifyContent: 'center',
  },
  packetMined: { borderColor: '#fb7185', backgroundColor: '#e11d48' },
  packetYours: { borderColor: '#fcd34d', backgroundColor: '#f59e0b' },
  packetTaken: { borderColor: 'rgba(180,83,9,0.6)', backgroundColor: 'rgba(136,19,55,0.8)' },
  packetGlyph: { fontSize: 13 },
  packetNum: { color: '#fde68a', fontSize: 9, fontWeight: '900', opacity: 0.8 },
  packetNumYours: { color: '#000' },
  packetOwner: {
    position: 'absolute',
    bottom: -6,
    maxWidth: '100%',
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 3,
    color: '#fde68a',
    fontSize: 8,
    fontWeight: '700',
    overflow: 'hidden',
  },
  sweepersTitle: {
    color: '#fcd34d',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 4,
  },
  sweepers: { gap: space.sm, paddingHorizontal: space.xs },
  sweeper: {
    minWidth: 84,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(180,83,9,0.4)',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: space.sm,
    paddingVertical: 4,
  },
  sweeperYou: { borderColor: '#fcd34d', backgroundColor: 'rgba(251,191,36,0.15)' },
  sweeperName: { color: '#fef3c7', fontSize: 11, fontWeight: '700' },
  sweeperStack: { color: 'rgba(252,211,77,0.8)', fontSize: 10 },
  sweeperCell: { color: '#fff', fontSize: 10, fontWeight: '900' },
  sweeperNet: { fontSize: 11, fontWeight: '900' },
  banker: {
    minWidth: 160,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.5)',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: space.md,
    paddingVertical: 6,
    alignItems: 'center',
  },
  bankerTitle: { color: '#fcd34d', fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  bankerName: { color: '#fff', fontSize: 12, fontWeight: '700' },
  bankerStack: { color: '#fde68a', fontSize: 11 },
  join: {
    borderRadius: radius.card,
    backgroundColor: theme.jackpot,
    paddingHorizontal: 32,
    paddingVertical: 10,
  },
  joinText: { color: '#000', fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  controls: { alignItems: 'center', gap: space.sm },
  chips: { flexDirection: 'row', gap: space.sm },
  chip: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: '#be123c',
    backgroundColor: RED_DARK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { borderColor: '#fcd34d', backgroundColor: '#f59e0b' },
  chipLocked: { opacity: 0.4 },
  chipText: { color: '#fde68a', fontSize: 11, fontWeight: '900' },
  chipTextOn: { color: '#000' },
  hint: { color: '#ffe4e6', fontSize: 11, textAlign: 'center' },
  balance: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
