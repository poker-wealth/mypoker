import type { HandRecord, Position } from './hand-record';

/**
 * A recorded hand, as ONE PLAYER may see it.
 *
 * The stored record carries every seat's hole cards — it has to, for hand-type
 * analysis. Handing that to a client as-is would let anyone read what their
 * opponents folded, hand after hand, which is the most valuable thing a poker
 * table keeps secret. So nothing leaves the gateway without passing through
 * here.
 *
 * THE RULE: you see your own cards, always. You see someone else's only if the
 * table saw them — which means a real showdown, with at least two players still
 * in. A player who won because everyone else folded never showed; the record
 * marks them as having "reached showdown", but their cards stayed face-down on
 * the table and stay hidden here.
 *
 * Pure: no database, no clock. Tested in test/history/hand-view.test.ts.
 */

export interface HandViewSeat {
  playerId: string;
  seatIndex: number;
  position: Position;
  /** Null when this viewer may not see them. */
  holeCards: string[] | null;
  /** Chips won or lost across the hand. Signed. */
  net: number;
  sawShowdown: boolean;
  wonAtShowdown: boolean;
  isYou: boolean;
}

export interface HandView {
  roundId: string;
  handNumber: number;
  playedAt: string;
  bigBlind: number;
  community: string[];
  seats: HandViewSeat[];
}

export function handViewFor(record: HandRecord, viewerId: string): HandView {
  // A showdown needs two hands to compare. One "survivor" is an uncontested pot.
  const contested = record.seats.filter((s) => s.sawShowdown).length >= 2;

  return {
    roundId: record.roundId,
    handNumber: record.handNumber,
    playedAt: new Date(record.playedAt).toISOString(),
    bigBlind: record.bigBlind,
    community: [...record.community],
    seats: record.seats.map((s) => {
      const isYou = s.playerId === viewerId;
      const shown = isYou || (contested && s.sawShowdown);
      return {
        playerId: s.playerId,
        seatIndex: s.seatIndex,
        position: s.position,
        holeCards: shown ? [...s.holeCards] : null,
        net: s.net,
        sawShowdown: s.sawShowdown,
        wonAtShowdown: s.wonAtShowdown,
        isYou,
      };
    }),
  };
}
