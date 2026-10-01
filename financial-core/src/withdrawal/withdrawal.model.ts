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
  /**
   * The txID of a signed transfer that has been sent to `broadcasttransaction` but whose result is
   * NOT known — either the call is still in flight, or it threw without telling us whether TronGrid's
   * node accepted it first (BUG-09). Set just before broadcasting, from APPROVED; cleared once the
   * withdrawal reaches BROADCASTING with a confirmed txHash. While set, a re-send must refuse — the
   * transaction may already be live on-chain, and admin must confirm/reject by checking the chain,
   * never by trying again.
   */
  pendingTxId?: string;
  /**
   * When the signed transaction behind `pendingTxId` expires on-chain (TronGrid's `raw_data.expiration`,
   * ms epoch — ~60s from build). Set alongside `pendingTxId`; used by the withdrawal watcher to decide
   * when an unresolved broadcast is safe to alert-and-release rather than leave waiting forever.
   */
  pendingTxExpiration?: Date;
  txHash?: string;
  failureReason?: string;
  /** BUG-09 follow-up (D9): who initiated the sign-broadcast that set `pendingTxId`, for the audit trail. */
  sentBy?: string;
  /** BUG-09 follow-up (D9): who resolved an unresolved send via `/broadcast` (or the ordinary sign-broadcast path). */
  resolvedBy?: string;
  /** BUG-09 follow-up (D9): the admin who refused this withdrawal via `/reject`. */
  rejectedBy?: string;
  /**
   * BUG-09 follow-up (D9): who confirmed, by checking the chain, that it was safe to refund a
   * withdrawal with an unresolved broadcast (the `chainChecked:true` reject). Distinct from
   * `rejectedBy` because an ordinary reject (no pendingTxId in play) never involves a chain check at
   * all — this is set only on that specific, higher-stakes path.
   */
  chainCheckedBy?: string;
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
    pendingTxId: { type: String, required: false },
    pendingTxExpiration: { type: Date, required: false },
    txHash: { type: String, required: false },
    failureReason: { type: String, required: false },
    sentBy: { type: String, required: false },
    resolvedBy: { type: String, required: false },
    rejectedBy: { type: String, required: false },
    chainCheckedBy: { type: String, required: false },
  },
  { timestamps: true, versionKey: false, minimize: false },
);

export const WithdrawalModel: Model<WithdrawalDoc> =
  (mongoose.models.Withdrawal as Model<WithdrawalDoc>) ??
  mongoose.model<WithdrawalDoc>('Withdrawal', withdrawalSchema);
