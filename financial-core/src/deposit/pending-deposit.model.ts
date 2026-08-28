import { Schema, model, Types } from 'mongoose';

/**
 * A deposit seen on chain but NOT yet confirmed.
 *
 * DELIBERATELY NOT THE LEDGER. The ledger records money that has moved; an
 * unconfirmed transfer has not moved any and may never — a reorg can erase it.
 * Writing a speculative ledger entry would put a claim in the permanent record
 * that the money path never made, and every balance derived from the ledger
 * would inherit it.
 *
 * So this is a sighting, nothing more: "the chain has told us something is on
 * its way to your address." It exists only so the wallet can say "pending"
 * instead of showing nothing at all while a player waits. No balance reads it,
 * no settlement touches it, and it never sums into a figure.
 *
 * One row per transaction hash, which makes recording idempotent on exactly the
 * key the credit is idempotent on. The row is deleted the moment the transfer
 * confirms — whether or not that confirmation resulted in a credit, since a
 * wrong-contract transfer also stops being "on its way".
 */
export interface PendingDepositDoc {
  /** The on-chain transaction hash. */
  _id: string;
  playerId: string;
  /** Denormalised so the wallet view can query by account, as it does for withdrawals. */
  playerAccountId: string;
  address: string;
  amount: Types.Decimal128;
  contract: string;
  createdAt: Date;
}

const schema = new Schema<PendingDepositDoc>(
  {
    _id: { type: String, required: true },
    playerId: { type: String, required: true },
    playerAccountId: { type: String, required: true, index: true },
    address: { type: String, required: true },
    // Decimal128, never a float — the same rule as everywhere else money is
    // stored, even though nothing spends this one.
    amount: { type: Schema.Types.Decimal128, required: true },
    contract: { type: String, required: true },
    createdAt: {
      type: Date,
      default: Date.now,
      // SELF-EXPIRING, and this is a correctness property, not housekeeping.
      //
      // An unconfirmed transfer can simply cease to exist: dropped from the
      // mempool, or erased by a reorg. Nothing would then ever arrive to clear
      // this row, and the player would be shown "pending" forever for money
      // that is never coming — which is worse than having shown them nothing,
      // because it reads as a promise.
      //
      // TRON confirms in about a minute, so an hour is far beyond any healthy
      // case. If it has not confirmed by then, the honest thing is to stop
      // claiming it is on its way. Expiry cannot lose money: the credit path is
      // entirely independent and will still credit a late confirmation.
      expires: Number(process.env.PENDING_DEPOSIT_TTL_SECONDS ?? 3600),
    },
  },
  { timestamps: false, collection: 'pending_deposits' },
);

export const PendingDepositModel = model<PendingDepositDoc>('PendingDeposit', schema);
