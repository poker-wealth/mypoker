import { randomUUID } from 'node:crypto';
import mongoose, { Schema, type Model } from 'mongoose';
import type { SettlementReceipt } from './settlement-receipt';

/**
 * settlements collection — one document per settled round.
 *
 * The unique `roundId` index is the round-level idempotency guard: a hand can be settled exactly
 * once (M1 Remediation §P1-05, UNIQUE(handId)). A replayed settleRound is a no-op.
 */

export interface SettlementDoc {
  _id: string;
  roundId: string;
  receipt: SettlementReceipt;
  /** Anchored to chain later (async). Null until the Merkle batch commits. */
  onChainTx?: string;
  createdAt: Date;
}

const settlementSchema = new Schema<SettlementDoc>(
  {
    _id: { type: String, default: (): string => randomUUID() },
    roundId: { type: String, required: true, unique: true },
    receipt: { type: Schema.Types.Mixed, required: true },
    onChainTx: { type: String, required: false },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, minimize: false },
);

export const SettlementModel: Model<SettlementDoc> =
  (mongoose.models.Settlement as Model<SettlementDoc>) ??
  mongoose.model<SettlementDoc>('Settlement', settlementSchema);
