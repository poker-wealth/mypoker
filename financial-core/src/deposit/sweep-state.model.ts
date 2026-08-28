import mongoose, { Schema, type Model } from 'mongoose';

/**
 * Per-address sweep state.
 *
 * One document per deposit address the sweeper has acted on. It does two jobs:
 *
 *   1. Cooldown — after gassing or sweeping an address, we leave it alone for a
 *      while so an in-flight transaction is not double-sent before it confirms.
 *      A sweep sends the address's whole balance; sending it twice is a
 *      double-spend attempt, so this guard is load-bearing, not cosmetic.
 *   2. Audit — the last action, its tx hash and time, so an operator can see
 *      what the sweeper did to any address.
 *
 * `_id` is the address itself, so the check is a single keyed read.
 */
export interface SweepStateDoc {
  _id: string; // the deposit address
  lastAction: 'gas' | 'sweep';
  lastTxHash: string;
  lastAmount?: string;
  lastActionAt: Date;
}

const sweepStateSchema = new Schema<SweepStateDoc>(
  {
    _id: { type: String },
    lastAction: { type: String, enum: ['gas', 'sweep'], required: true },
    lastTxHash: { type: String, required: true },
    lastAmount: { type: String },
    lastActionAt: { type: Date, required: true },
  },
  { versionKey: false },
);

export const SweepStateModel: Model<SweepStateDoc> =
  (mongoose.models.SweepState as Model<SweepStateDoc>) ??
  mongoose.model<SweepStateDoc>('SweepState', sweepStateSchema);
