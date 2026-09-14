import mongoose, { Schema, type Model } from 'mongoose';
import type { HandRecord } from './hand-record';

/**
 * Where hand histories are kept.
 *
 * ONE DOCUMENT PER HAND, not per player-hand. A hand is the unit that actually
 * happened; splitting it per seat would duplicate the board and the action log
 * once per player and make "what happened in this hand" a join.
 *
 * INDEXED BY PLAYER AND TIME, because that is the only question anyone asks of
 * it: "this player's hands, over this window." `seats.playerId` with
 * `playedAt` descending serves the Data page, the profile stat row and the
 * hand scrubber from one index.
 *
 * NO TTL. These are the record of play — the thing a player points at when they
 * dispute a result, and the thing the fairness verifier is checked against.
 * Expiring them quietly would mean the app could not answer the one question it
 * most needs to answer. If they ever need trimming, that is a retention
 * decision someone takes deliberately, not a default set here.
 *
 * MONEY IS NOT DUPLICATED. `net` is recorded in table chips so the play-side
 * statistics (BB/100, profit by position) can be computed without a join, but
 * the LEDGER remains the authority on what moved — these two are joined by
 * `roundId`, which settlement already mints. If they ever disagree, the ledger
 * is right (iron rule 1: money moves through `transfer()`, and nothing here
 * touches that path).
 */

const actionSchema = new Schema(
  {
    playerId: { type: String, required: true },
    street: { type: String, required: true },
    type: { type: String, required: true },
    amount: { type: Number, required: true },
  },
  { _id: false },
);

const seatSchema = new Schema(
  {
    playerId: { type: String, required: true },
    seatIndex: { type: Number, required: true },
    position: { type: String, required: true },
    holeCards: { type: [String], default: [] },
    invested: { type: Number, required: true },
    net: { type: Number, required: true },
    sawShowdown: { type: Boolean, default: false },
    wonAtShowdown: { type: Boolean, default: false },
  },
  { _id: false },
);

const handRecordSchema = new Schema<HandRecord>(
  {
    // The settlement id. UNIQUE, so a retried write cannot double-count a hand
    // into somebody's statistics — the one way this collection could lie.
    roundId: { type: String, required: true, unique: true, index: true },
    tableId: { type: String, required: true, index: true },
    gameId: { type: String, required: true },
    handNumber: { type: Number, required: true },
    playedAt: { type: Date, required: true },
    bigBlind: { type: Number, required: true },
    community: { type: [String], default: [] },
    seats: { type: [seatSchema], default: [] },
    actions: { type: [actionSchema], default: [] },
  },
  { versionKey: false, collection: 'handrecords' },
);

// The only query this collection serves: a player's hands, newest first.
handRecordSchema.index({ 'seats.playerId': 1, playedAt: -1 });

export const HandRecordModel: Model<HandRecord> =
  (mongoose.models.HandRecord as Model<HandRecord>) ??
  mongoose.model<HandRecord>('HandRecord', handRecordSchema);
