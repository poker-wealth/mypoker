import { randomUUID } from 'node:crypto';
import { Decimal128 } from 'bson';
import mongoose, { Schema, type HydratedDocument, type Model } from 'mongoose';
import { LedgerType, LEDGER_TYPES, LedgerDirection, LedgerStatus } from '../domain/account-types';

/**
 * ledger collection — the single source of truth for ALL fund movement (spec §3.2).
 *
 * Double-entry (M1 Remediation §P0-01): every transfer produces TWO entries sharing one
 * `idempotencyKey` — a DEBIT on the source account and a CREDIT on the destination — with equal
 * `amount`. The system invariant Σ(DEBIT) = Σ(CREDIT) must hold at all times.
 *
 * `idempotencyKey` is the dedup guard: a unique (idempotencyKey, direction) index makes a repeated
 * transfer physically impossible to double-insert. Replays are detected by querying the key.
 */

export interface LedgerEntryAttrs {
  /** Shared across the DEBIT/CREDIT pair of a single transfer. Dedup guard. */
  idempotencyKey: string;
  /** Domain event this movement belongs to (roundId / withdrawalId / depositTxHash …). */
  businessId?: string;
  accountId: string;
  /** The opposite account in this transfer (for traceability / reconciliation reads). */
  counterpartyAccountId: string;
  direction: LedgerDirection;
  amount: Decimal128;
  type: LedgerType;
  status?: LedgerStatus;
  metadata?: Record<string, unknown>;
}

export interface LedgerEntryDoc {
  _id: string;
  idempotencyKey: string;
  businessId?: string;
  accountId: string;
  counterpartyAccountId: string;
  direction: LedgerDirection;
  amount: Decimal128;
  type: LedgerType;
  status: LedgerStatus;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export type LedgerEntryHydrated = HydratedDocument<LedgerEntryDoc>;

const ledgerSchema = new Schema<LedgerEntryDoc>(
  {
    _id: { type: String, default: (): string => randomUUID() },
    idempotencyKey: { type: String, required: true },
    businessId: { type: String, required: false },
    accountId: { type: String, required: true, index: true },
    counterpartyAccountId: { type: String, required: true },
    direction: { type: String, enum: Object.values(LedgerDirection), required: true },
    amount: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        // amount MUST be > 0 (spec §3.2). Sign is carried by `direction`, never by the number.
        validator: (v: Decimal128): boolean => parseFloat(v.toString()) > 0,
        message: 'ledger amount must be > 0',
      },
    },
    type: { type: String, enum: LEDGER_TYPES, required: true, index: true },
    status: {
      type: String,
      enum: Object.values(LedgerStatus),
      required: true,
      default: LedgerStatus.SETTLED,
    },
    metadata: { type: Schema.Types.Mixed, required: false },
  },
  {
    // Ledger entries are immutable facts — created, never updated. No updatedAt.
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    minimize: false,
  },
);

// Dedup guard: a transfer's DEBIT and CREDIT each appear exactly once.
ledgerSchema.index({ idempotencyKey: 1, direction: 1 }, { unique: true });
// Reconciliation / history reads.
ledgerSchema.index({ businessId: 1 });
ledgerSchema.index({ createdAt: 1 });

export const LedgerModel: Model<LedgerEntryDoc> =
  (mongoose.models.Ledger as Model<LedgerEntryDoc>) ??
  mongoose.model<LedgerEntryDoc>('Ledger', ledgerSchema);
