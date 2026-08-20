import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { PlayingCard } from './PlayingCard';
import { PlayerSeat } from './PlayerSeat';
import type { TableSnapshot } from '../../lib/liveTable';

/**
 * The Hold'em table.
 *
 * Ported from `frontend/src/components/poker/PokerTable.tsx`. The web version lays seats on table
 * ARTWORK using percentages measured off each design's image; this draws the felt instead, for two
 * reasons: bundling the artwork is Samuel's asset pipeline, and a drawn table cannot drift out of
 * step with the seat positions the way a swapped image can. The web app has a CSS fallback for the
 * same reason, and this is its native equivalent.
 *
 * Seats are placed by percentage around a stadium, rotated so YOU are always at the near edge —
 * whichever chair the server actually gave you. A player reads their own hand from the bottom.
 */

export interface PokerTableProps {
  snapshot: TableSnapshot;
  /** Sit in a given seat index. Absent when sitting is not on offer. */
  onSit?: (seatIndex: number) => void;
  accent?: string;
}

/**
 * Where each chair sits, as a percentage of the felt, starting at the near edge and going round.
 * Slot 0 always belongs to the viewer.
 */
const SLOTS = [
  { left: 50, top: 88 },
  { left: 16, top: 74 },
  { left: 8, top: 42 },
  { left: 32, top: 12 },
  { left: 68, top: 12 },
  { left: 92, top: 42 },
  { left: 84, top: 74 },
];

export function PokerTable({ snapshot, onSit, accent = '#f5c451' }: PokerTableProps) {
  const { width } = useWindowDimensions();
  // A fixed aspect keeps the seat percentages meaningful on any screen.
  const feltWidth = width - 24;
  const feltHeight = Math.min(feltWidth * 1.15, 460);

  const you = snapshot.seats.find((s) => s.isYou);
  const seats = snapshot.seats;

  /**
   * Rotate so the viewer is at slot 0. A spectator has no seat, so the order is left as the server
   * sent it — there is no "your" edge to rotate to.
   */
  const yourIndex = you ? seats.findIndex((s) => s.index === you.index) : -1;
  const ordered =
    yourIndex > 0 ? [...seats.slice(yourIndex), ...seats.slice(0, yourIndex)] : seats;

  const board = snapshot.board ?? [];

  return (
    <View style={[styles.stage, { width: feltWidth, height: feltHeight }]}>
      {/* The felt: rail, trim, cloth. */}
      <View style={styles.rail}>
        <View style={styles.trim}>
          <View style={styles.cloth} />
        </View>
      </View>

      {/* The middle: pot, then the board. */}
      <View style={styles.centre} pointerEvents="none">
        {snapshot.pot > 0 && (
          <View style={styles.pot}>
            <Text style={[styles.potText, { color: accent }]}>POT ₮{snapshot.pot}</Text>
          </View>
        )}

        <View style={styles.board}>
          {Array.from({ length: 5 }, (_, i) => {
            const card = board[i];
            // Streets still to come are drawn as backs, so the board keeps its shape as it fills.
            return <PlayingCard key={i} {...(card ? { card } : {})} size="md" />;
          })}
        </View>

        {snapshot.message ? <Text style={styles.message}>{snapshot.message}</Text> : null}
      </View>

      {/* Seats on the rail. */}
      {ordered.map((seat, place) => {
        const slot = SLOTS[place % SLOTS.length]!;
        const canSit = !seat.playerId && !you && onSit ? () => onSit(seat.index) : undefined;
        return (
          <View
            key={seat.index}
            style={[
              styles.seat,
              {
                left: (slot.left / 100) * feltWidth,
                top: (slot.top / 100) * feltHeight,
              },
            ]}
          >
            <PlayerSeat
              seat={seat}
              {...(canSit ? { onSit: canSit } : {})}
              toAct={snapshot.toActSeat === seat.index}
              accent={accent}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignSelf: 'center', marginVertical: 8 },
  rail: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    bottom: 8,
    borderRadius: 999,
    backgroundColor: '#14100d',
    padding: 10,
  },
  trim: { flex: 1, borderRadius: 999, backgroundColor: '#8a6a24', padding: 3 },
  cloth: { flex: 1, borderRadius: 999, backgroundColor: '#0c7a4a' },
  centre: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '38%',
    alignItems: 'center',
    gap: 6,
  },
  pot: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  potText: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  board: { flexDirection: 'row', gap: 3 },
  message: {
    color: '#fff',
    fontSize: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  // Seats are positioned by their centre, so shift them by half their own size.
  seat: { position: 'absolute', marginLeft: -37, marginTop: -34 },
});
