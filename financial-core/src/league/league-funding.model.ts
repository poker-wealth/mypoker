import mongoose, { Schema, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import type { Decimal128 } from 'bson';

/**
 * League top-up and cash-out requests — the audit trail for money moving
 * between the platform treasury and a league's inventory.
 *
 * A request, not a transfer. The spec makes both a workflow rather than an
 * action: "league admin initiates top-up request… platform ops confirms TRC20
 * receipt… ops executes transfer(TREASURY, LEAGUE_INVENTORY…)" and "league
 * admin requests cash-out… platform ops reviews". Nobody moves league money
 * with one click, in either direction.
 *
 * Deliberately shaped like the withdrawal state machine, which solves the same
 * problem: a human decision standing between an intent and a fund movement,
 * with the intent recorded either way. A rejected request is as much a record
 * as an executed one.
 */

export type LeagueFundingKind = 'TOPUP' | 'CASHOUT';

export type LeagueFundingState =
  /** Recorded. No money has moved. */
  | 'REQUESTED'
  /** Ops has signed off. Money still has not moved. */
  | 'APPROVED'
  /** The transfer is written to the ledger. Terminal. */
  | 'EXECUTED'
  /** Refused. Terminal, and kept — a refusal is a record. */
  | 'REJECTED';

export interface LeagueFundingDoc {
  _id: string;
  leagueId: string;
  kind: LeagueFundingKind;
  amount: Decimal128;
  state: LeagueFundingState;
  /** The league admin who asked. */
  requestedBy: string;
  /**
   * Ops playerIds who approved, as a SET (see approveLeagueFunding).
   *
   * Same reasoning as withdrawals: the spec says a second PERSON for large
   * top-ups, and a counter cannot tell one reviewer clicking twice from two
   * reviewers agreeing.
   */
  approvals: string[];
  rejectedBy?: string;
  rejectionReason?: string;
  /** For cash-out: where the TRC-20 goes. Captured at request time. */
  address?: string;
  /** The on-chain send, once it happens. Out of scope for the ledger move. */
  txHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<LeagueFundingDoc>(
  {
    _id: { type: String, default: (): string => randomUUID() },
    leagueId: { type: String, required: true, index: true },
    kind: { type: String, enum: ['TOPUP', 'CASHOUT'], required: true },
    amount: { type: Schema.Types.Decimal128, required: true },
    state: {
      type: String,
      enum: ['REQUESTED', 'APPROVED', 'EXECUTED', 'REJECTED'],
      required: true,
      default: 'REQUESTED',
      index: true,
    },
    requestedBy: { type: String, required: true },
    approvals: { type: [String], default: [] },
    rejectedBy: { type: String, required: false },
    rejectionReason: { type: String, required: false },
    address: { type: String, required: false },
    txHash: { type: String, required: false },
  },
  { timestamps: true, versionKey: false, minimize: false },
);

// The cash-out cooldown asks "when did this league last request one", and the
// review queue asks "what is outstanding". Both read by league and recency.
schema.index({ leagueId: 1, kind: 1, createdAt: -1 });

export const LeagueFundingModel: Model<LeagueFundingDoc> =
  (mongoose.models.LeagueFunding as Model<LeagueFundingDoc>) ??
  mongoose.model<LeagueFundingDoc>('LeagueFunding', schema);
