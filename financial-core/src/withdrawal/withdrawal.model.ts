import { randomUUID } from 'node:crypto';
import { Decimal128 } from 'bson';
import mongoose, { Schema, type Model } from 'mongoose';
import { WithdrawalState } from '../domain/withdrawal-types';

/**
 * withdrawals collection — the lifecycle audit trail for every withdrawal. The state field is the
 * single source of truth for where each withdrawal is; the three-balance moves are driven from it.
 */

export interface WithdrawalDoc {
  _id: string;
  playerAccountId: string;
  amount: Decimal128;
  /** Destination on-chain address. */
  address: string;
  state: WithdrawalState;
  txHash?: string;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const withdrawalSchema = new Schema<WithdrawalDoc>(
  {
    _id: { type: String, default: (): string => randomUUID() },
    playerAccountId: { type: String, required: true, index: true },
    amount: { type: Schema.Types.Decimal128, required: true },
    address: { type: String, required: true },
    state: {
      type: String,
      enum: Object.values(WithdrawalState),
      required: true,
      default: WithdrawalState.REQUESTED,
      index: true,
    },
    txHash: { type: String, required: false },
    failureReason: { type: String, required: false },
  },
  { timestamps: true, versionKey: false, minimize: false },
);

export const WithdrawalModel: Model<WithdrawalDoc> =
  (mongoose.models.Withdrawal as Model<WithdrawalDoc>) ??
  mongoose.model<WithdrawalDoc>('Withdrawal', withdrawalSchema);
