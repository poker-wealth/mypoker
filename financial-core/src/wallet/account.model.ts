import { randomUUID } from 'node:crypto';
import { Decimal128 } from 'bson';
import mongoose, { Schema, type HydratedDocument, type Model } from 'mongoose';
import { AccountType, ACCOUNT_TYPES, PLATFORM_SCOPE } from '../domain/account-types';

/**
 * accounts collection — one document per fund pool.
 *
 * Three-balance model (M1 Remediation §P0-04), each an exact Decimal128:
 *   - availableBalance: spendable funds.
 *   - lockedBalance:    funds committed to a live table buy-in (frozen, not spendable, not withdrawable).
 *   - clearingBalance:  funds in-flight on a withdrawal (deducted from available, awaiting on-chain settle).
 *
 * NO code may write these fields directly except via `transfer()` / the withdrawal state machine,
 * both of which use the optimistic `version` lock. Direct UPDATE is forbidden (spec §3.2).
 */

const ZERO = (): Decimal128 => Decimal128.fromString('0');

export interface AccountAttrs {
  accountType: AccountType;
  /** playerId / leagueId / tableId / 'PLATFORM'. */
  ownerId: string;
  /** 'PLATFORM' or `league:<leagueId>`. Separates a player's platform vs league wallet. */
  scope?: string;
}

export interface AccountDoc {
  _id: string;
  accountType: AccountType;
  ownerId: string;
  scope: string;
  availableBalance: Decimal128;
  lockedBalance: Decimal128;
  clearingBalance: Decimal128;
  /** Optimistic-lock counter. Incremented on every balance mutation by transfer(). */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type AccountHydrated = HydratedDocument<AccountDoc>;

const accountSchema = new Schema<AccountDoc>(
  {
    _id: { type: String, default: (): string => randomUUID() },
    accountType: { type: String, enum: ACCOUNT_TYPES, required: true, index: true },
    ownerId: { type: String, required: true },
    scope: { type: String, required: true, default: PLATFORM_SCOPE },
    availableBalance: { type: Schema.Types.Decimal128, required: true, default: ZERO },
    lockedBalance: { type: Schema.Types.Decimal128, required: true, default: ZERO },
    clearingBalance: { type: Schema.Types.Decimal128, required: true, default: ZERO },
    version: { type: Number, required: true, default: 0 },
  },
  {
    timestamps: true,
    // We manage `version` ourselves for the spec's optimistic-lock pattern; disable Mongoose's __v.
    versionKey: false,
    // Money is exact: never let Mongoose coerce Decimal128 to JS number on the way out.
    minimize: false,
  },
);

// One account per (type, owner, scope). e.g. a player's platform wallet is unique; each table's
// JACKPOT_MINI is unique; the single PLATFORM treasury is unique.
accountSchema.index({ accountType: 1, ownerId: 1, scope: 1 }, { unique: true });

export const AccountModel: Model<AccountDoc> =
  (mongoose.models.Account as Model<AccountDoc>) ??
  mongoose.model<AccountDoc>('Account', accountSchema);
