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
  /**
   * Ops user ids that have approved this withdrawal. Over the dual-confirm
   * threshold it needs two DISTINCT ones before the funds are held and it
   * advances to APPROVED. See the schema note below for why it is a set of
   * names rather than a counter.
   */
  approvals?: string[];
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
    /**
     * Who has approved this, by ops playerId (§3.6: APPROVED requires "risk
     * control passed + human review (> $10K)").
     *
     * A set of names, not a counter, and written with `$addToSet`. The rule is
     * "a second PERSON", so one reviewer clicking twice must not release the
     * money — a counter cannot tell those apart and the database can.
     *
     * It is also the audit trail. After a large withdrawal, the first question
     * is who released it, and a count answers that with a number instead of a
     * name.
     */
    approvals: { type: [String], default: [] },
    txHash: { type: String, required: false },
    failureReason: { type: String, required: false },
  },
  { timestamps: true, versionKey: false, minimize: false },
);

export const WithdrawalModel: Model<WithdrawalDoc> =
  (mongoose.models.Withdrawal as Model<WithdrawalDoc>) ??
  mongoose.model<WithdrawalDoc>('Withdrawal', withdrawalSchema);
