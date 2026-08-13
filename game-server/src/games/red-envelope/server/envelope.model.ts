import mongoose, { Schema, Document, Model } from 'mongoose';
import type { EnvelopeState } from '../engine/packet/state';
import type { MineDigitMode } from '../engine/mine/digitExtractor';
import type { RoundingPolicy } from '../engine/money/rounding';

export interface IRedEnvelope {
  hostId: string;
  totalAmountUnits: number;
  packetCount: number;
  remainingPackets: number;
  mineNumber: number;
  mineMode: MineDigitMode;
  penaltyMultiplier: number;
  roundingPolicy: RoundingPolicy;
  
  state: EnvelopeState;
  
  // The pre-generated randomized amounts
  packetAmounts: number[];
  
  // Who claimed what index
  claims: {
    playerId: string;
    packetIndex: number;
    amountUnits: number;
    mineHit: boolean;
    penaltyUnits: number;
    netChangeUnits: number;
    claimedAt: Date;
  }[];

  createdAt: Date;
  expiresAt: Date;
}

export interface RedEnvelopeDoc extends IRedEnvelope, Document {}

const RedEnvelopeSchema = new Schema<IRedEnvelope>(
  {
    hostId: { type: String, required: true },
    totalAmountUnits: { type: Number, required: true, min: 1 },
    packetCount: { type: Number, required: true, min: 1 },
    remainingPackets: { type: Number, required: true, min: 0 },
    mineNumber: { type: Number, required: true, min: 0, max: 9 },
    mineMode: { type: String, required: true, enum: ['LAST_WHOLE_DIGIT', 'LAST_DECIMAL_DIGIT'] },
    penaltyMultiplier: { type: Number, required: true, min: 0 },
    roundingPolicy: { type: String, required: true, enum: ['ROUND_DOWN', 'ROUND_UP', 'ROUND_HALF_UP'] },
    
    state: { 
      type: String, 
      required: true, 
      enum: ['DRAFT', 'ACTIVE', 'SETTLING', 'COMPLETED', 'EXPIRED'],
      default: 'DRAFT'
    },

    packetAmounts: { type: [Number], required: true },

    claims: [
      {
        playerId: { type: String, required: true },
        packetIndex: { type: Number, required: true },
        amountUnits: { type: Number, required: true },
        mineHit: { type: Boolean, required: true },
        penaltyUnits: { type: Number, required: true },
        netChangeUnits: { type: Number, required: true },
        claimedAt: { type: Date, default: Date.now },
      },
    ],

    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'red_envelopes' }
);

// Indexes for concurrent findOneAndUpdate performance and queries
RedEnvelopeSchema.index({ state: 1, expiresAt: 1 });
RedEnvelopeSchema.index({ 'claims.playerId': 1 }); // to quickly check if a user already claimed

export const RedEnvelopeModel: Model<RedEnvelopeDoc> = 
  mongoose.models.RedEnvelope || mongoose.model<RedEnvelopeDoc>('RedEnvelope', RedEnvelopeSchema);
