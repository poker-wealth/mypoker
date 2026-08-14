import mongoose, { Schema, Document, Model } from 'mongoose';

export type LedgerEntryType = 'ENVELOPE_CREATE' | 'CLAIM_PRIZE' | 'CLAIM_PENALTY' | 'REFUND_UNCLAIMED';

export interface IRedEnvelopeLedgerEntry {
  envelopeId: string;
  playerId: string;
  type: LedgerEntryType;
  amountUnits: number;
  balanceAfterUnits: number;
  timestamp: Date;
  referenceId: string; // e.g. "claim-5", "create"
}

export interface RedEnvelopeLedgerEntryDoc extends IRedEnvelopeLedgerEntry, Document {}

const RedEnvelopeLedgerEntrySchema = new Schema<IRedEnvelopeLedgerEntry>(
  {
    envelopeId: { type: String, required: true },
    playerId: { type: String, required: true },
    type: { 
      type: String, 
      required: true,
      enum: ['ENVELOPE_CREATE', 'CLAIM_PRIZE', 'CLAIM_PENALTY', 'REFUND_UNCLAIMED']
    },
    amountUnits: { type: Number, required: true },
    balanceAfterUnits: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
    referenceId: { type: String, required: true },
  },
  { collection: 'red_envelope_ledger' }
);

// Indexes to query history for an envelope or player
RedEnvelopeLedgerEntrySchema.index({ envelopeId: 1, timestamp: -1 });
RedEnvelopeLedgerEntrySchema.index({ playerId: 1, timestamp: -1 });

export const RedEnvelopeLedgerModel = 
  (mongoose.models.RedEnvelopeLedgerEntry || mongoose.model('RedEnvelopeLedgerEntry', RedEnvelopeLedgerEntrySchema)) as Model<IRedEnvelopeLedgerEntry>;
