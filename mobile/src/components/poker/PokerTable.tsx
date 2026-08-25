import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { PlayingCard } from './PlayingCard';
import { PlayerSeat } from './PlayerSeat';
import { designById, ringFor, type TableDesign } from '../../table/tableDesigns';
import { useTableDesign } from '../../table/tableDesignStore';
import { PotToWinner } from './PotToWinner';
import { theme } from '../../theme';
import type { LiveSeat, TableSnapshot } from '../../lib/liveTable';

/** One position on the rail: the seat index and whoever the server says is sitting there, if
 * anyone. `seat` is `null` for a chair no one occupies — never a fabricated `LiveSeat`. */
interface RingSlot {
  index: number;
  seat: LiveSeat | null;
}

/**
 * The Hold'em table.
 *
 * A port of `frontend/src/components/poker/PokerTable.tsx`, using the SAME artwork and the SAME
 * seat rings — the picture and the positions measured off it travel together, or players end up
 * floating off the rail.
 *
 * Seats are rotated so YOU are at the near edge, whichever chair the server actually gave you: a
 * player reads their own hand from the bottom of the table. A spectator sees the server's order,
 * because there is no "your" edge to rotate to.
 */

export interface PokerTableProps {
  snapshot: TableSnapshot;
  /** Sit in a seat index. Absent when sitting is not on offer. */
  onSit?: (seatIndex: number) => void;
  /** Override the player's chosen design — used by a design picker's previews. */
  design?: TableDesign;
}

export function PokerTable({ snapshot, onSit, design: override }: PokerTableProps) {
  const { width } = useWindowDimensions();
  // The player's saved choice, unless a preview is forcing one.
  const { id: chosen } = useTableDesign();
  const design = override ?? designById(chosen);

  // As wide as the screen allows, as tall as the artwork's aspect demands.
  const tableWidth = Math.min(width - 24, 440);
  const tableHeight = tableWidth / design.aspect;

  const you = snapshot.seats.find((s) => s.isYou);

  // The server sends only OCCUPIED seats (game-server/src/live/poker-room.ts builds the snapshot
  // from `this.occupied()`, unlike other room types that pad their seat list with placeholders);
  // `maxSeats` is the real chair count, reported separately. Build the full ring of `maxSeats`
  // positions up front and overlay whichever ones the server did report onto it by `index` —
  // otherwise an empty (or partly empty) table renders as bare felt with no way to sit down.
  const seatCount = Math.max(2, snapshot.maxSeats || 0);
  const byIndex = new Map(snapshot.seats.map((s) => [s.index, s]));
  const slots: RingSlot[] = Array.from({ length: seatCount }, (_, index) => ({
    index,
    seat: byIndex.get(index) ?? null,
  }));
  const ring = ringFor(design, seatCount);

  const yourIndex = you?.index ?? snapshot.yourSeat ?? -1;
  const yourPlace = yourIndex >= 0 ? slots.findIndex((s) => s.index === yourIndex) : -1;
  const ordered = yourPlace > 0 ? [...slots.slice(yourPlace), ...slots.slice(0, yourPlace)] : slots;

  const board = snapshot.board ?? [];

  return (
    <View style={[styles.stage, { width: tableWidth, height: tableHeight }]}>
      {design.art ? (
        <Image source={design.art} style={styles.art} resizeMode="contain" />
      ) : (
        // The brand-palette fallback, matching the web's CSS table.
        <View style={styles.cssTable} />
      )}

      {/* The middle of the felt: pot above the board, as the web lays it out. */}
      <View
        style={[styles.centre, { top: (design.boardTop / 100) * tableHeight }]}
        pointerEvents="none"
      >
        {snapshot.pot > 0 && (
          <View style={styles.pot}>
            <Text style={[styles.potText, { color: design.accent }]}>POT ₮{snapshot.pot}</Text>
          </View>
        )}

        <View style={styles.board}>
          {/* Streets still to come stay as backs, so the board keeps its shape as it fills. */}
          {Array.from({ length: 5 }, (_, i) => {
            const card = board[i];
            return <PlayingCard key={i} {...(card ? { card } : {})} size="md" />;
          })}
        </View>

        {snapshot.message ? <Text style={styles.message}>{snapshot.message}</Text> : null}
      </View>

      {ordered.map((ringSlot, place) => {
        const pos = ring[place % ring.length]!;
        const style = [
          styles.seat,
          { left: (pos.left / 100) * tableWidth, top: (pos.top / 100) * tableHeight },
        ];

        if (ringSlot.seat) {
          const seat = ringSlot.seat;
          return (
            <View key={ringSlot.index} style={style}>
              <PlayerSeat seat={seat} toAct={snapshot.toActSeat === seat.index} accent={design.accent} />
            </View>
          );
        }

        // An empty chair. `LiveSeat` requires a playerId/name/stack, so there is no such thing as
        // an empty one — inventing one just to hand it to `PlayerSeat` would mean carrying a fake
        // zero stack around as if it were real data. Render the same "+ SIT" affordance PlayerSeat
        // draws for an unoccupied seat, directly, and hand `onSit` the RING index — the seat index
        // the server expects.
        const sit = !you && onSit ? () => onSit(ringSlot.index) : undefined;
        return (
          <View key={`empty-${ringSlot.index}`} style={style}>
            {sit ? (
              <Pressable
                onPress={sit}
                style={({ pressed }) => [
                  styles.emptyAvatar,
                  styles.emptyOpen,
                  { borderColor: design.accent },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.sitText, { color: design.accent }]}>+ SIT</Text>
              </Pressable>
            ) : (
              <View style={[styles.emptyAvatar, styles.emptyInert]} />
            )}
          </View>
        );
      })}

      {/* The pot arriving at whoever won it. Purely decorative — the ledger settled long before
          this mounts — and it animates to the ROTATED seat positions, so the award lands on the
          chair the player is actually looking at. */}
      <PotToWinner
        handId={snapshot.handId}
        amount={snapshot.pot}
        winners={ordered
          .map((slot, place) => (slot.seat?.isWinner ? ring[place % ring.length]! : null))
          .filter((p): p is NonNullable<typeof p> => p !== null)}
        tableWidth={tableWidth}
        tableHeight={tableHeight}
        potTop={design.boardTop}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignSelf: 'center', marginVertical: 8 },
  art: { position: 'absolute', width: '100%', height: '100%' },
  cssTable: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    bottom: 8,
    borderRadius: 999,
    borderWidth: 10,
    borderColor: '#14100d',
    backgroundColor: '#2a1a4a',
  },
  centre: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 6 },
  pot: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  potText: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  board: { flexDirection: 'row', gap: 3 },
  message: {
    color: theme.text,
    fontSize: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  // Seats are placed by their centre, so shift each by half its own size.
  seat: { position: 'absolute', marginLeft: -37, marginTop: -34 },
  // Matches PlayerSeat's own AVATAR / emptyOpen / emptyInert / sitText treatment for an
  // unoccupied chair, so a ring slot with no `LiveSeat` still looks like the rest of the rail.
  emptyAvatar: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  emptyOpen: { borderWidth: 2, borderStyle: 'dashed', backgroundColor: 'rgba(0,0,0,0.55)' },
  emptyInert: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  pressed: { opacity: 0.7 },
  sitText: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
});
