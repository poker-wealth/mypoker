import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PlayingCard } from './PlayingCard';
import { ChipStack } from './ChipStack';
import type { LiveSeat } from '../../lib/liveTable';

/**
 * One seat on the rail.
 *
 * Ported from `frontend/src/components/poker/PlayerSeat.tsx`, keeping the signals that tell a
 * player what is happening without reading any text: a ring on the seat to act, colour drained out
 * of a folded one, a gold edge on a winner, a dot for a dropped connection, and the dealer button
 * clipped to the side.
 *
 * An empty chair only invites you to sit when sitting is actually on offer. Once you are seated,
 * `onSit` is absent and the chair renders as an inert outline — a ring of "+ SIT" buttons that do
 * nothing is noise on the felt, and the web app shipped exactly that bug once.
 */

export interface PlayerSeatProps {
  seat: LiveSeat;
  /** Sitting down in this chair. Absent means sitting is not on offer. */
  onSit?: () => void;
  /** True when it is this seat's turn — the server decides, never the client. */
  toAct?: boolean;
  accent?: string;
}

const AVATAR = 54;

export function PlayerSeat({ seat, onSit, toAct = false, accent = '#f5c451' }: PlayerSeatProps) {
  if (!seat.playerId) {
    if (!onSit) return <View style={[styles.avatar, styles.emptyInert]} />;
    return (
      <Pressable
        onPress={onSit}
        style={({ pressed }) => [
          styles.avatar,
          styles.emptyOpen,
          { borderColor: accent },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.sitText, { color: accent }]}>+ SIT</Text>
      </Pressable>
    );
  }

  const folded = seat.status === 'folded';
  const allIn = seat.status === 'allin';

  return (
    <View style={styles.wrap}>
      {/* Hole cards sit behind the avatar; the hero's are larger and above it. */}
      {!folded && seat.cards.length > 0 && (
        <View style={[styles.cards, seat.isYou && styles.heroCards]}>
          {seat.cards.map((c, i) => (
            <PlayingCard key={i} card={c} faceDown={!c} size={seat.isYou ? 'md' : 'sm'} />
          ))}
        </View>
      )}

      <View
        style={[
          styles.avatar,
          styles.occupied,
          folded && styles.foldedSeat,
          toAct && { borderColor: accent, borderWidth: 2 },
          seat.isWinner && styles.winner,
        ]}
      >
        <Text style={styles.initial}>{(seat.name || '?').slice(0, 1).toUpperCase()}</Text>

        {seat.isDealer && (
          <View style={styles.dealer}>
            <Text style={styles.dealerText}>D</Text>
          </View>
        )}

        {/* A dropped socket keeps the seat and the clock — say so rather than hiding it. */}
        {seat.connected === false && <View style={styles.offline} />}
      </View>

      <View style={[styles.plate, folded && styles.foldedSeat]}>
        <Text style={styles.name} numberOfLines={1}>
          {seat.name}
        </Text>
        <Text style={styles.stack}>₮{seat.stack}</Text>
      </View>

      {allIn && <Text style={styles.allIn}>ALL-IN</Text>}

      {/* What they last did this street, as the server phrased it. */}
      {seat.lastAction ? <Text style={styles.lastAction}>{seat.lastAction}</Text> : null}

      {/* Chips in front of the seat, the way the felt shows a bet. */}
      {seat.bet > 0 && <ChipStack amount={seat.bet} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 2 },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyInert: { borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.2)' },
  emptyOpen: { borderWidth: 2, borderStyle: 'dashed', backgroundColor: 'rgba(0,0,0,0.55)' },
  pressed: { opacity: 0.7 },
  sitText: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  occupied: { backgroundColor: '#1e1b4b', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  foldedSeat: { opacity: 0.45 },
  winner: { borderColor: '#facc15', borderWidth: 2 },
  initial: { color: '#fff', fontWeight: '800', fontSize: 20 },
  dealer: {
    position: 'absolute',
    right: -4,
    top: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#f5c451',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dealerText: { color: '#000', fontSize: 10, fontWeight: '900' },
  offline: {
    position: 'absolute',
    left: -2,
    top: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#f85677',
  },
  plate: {
    minWidth: 74,
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  name: { color: '#fff', fontSize: 11, fontWeight: '700' },
  stack: { color: '#8b8bb0', fontSize: 10 },
  allIn: { color: '#f85677', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  lastAction: { color: '#f5c451', fontSize: 9 },
  betChip: {
    marginTop: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(245,196,81,0.2)',
  },
  betText: { color: '#f5c451', fontSize: 10, fontWeight: '700' },
  cards: { flexDirection: 'row', gap: 2, marginBottom: 2 },
  heroCards: { gap: 4 },
});
