import mongoose, { Schema, type Model } from 'mongoose';
import { withdrawalAddressCooldownMs } from '../config/chain';

/**
 * A player's registered withdrawal address (spec §3.6).
 *
 * Withdrawals may only go to this address, and CHANGING it starts a cooldown (default 48h) before
 * withdrawals to the new address are allowed — so a compromised account cannot immediately redirect
 * funds to an attacker's address. Setting the SAME address again is a no-op and does not restart the
 * cooldown. One record per player (`_id` = playerId).
 */

export interface WithdrawalAddressDoc {
  _id: string; // playerId
  address: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<WithdrawalAddressDoc>(
  {
    _id: { type: String },
    address: { type: String, required: true },
  },
  { timestamps: true, versionKey: false },
);

export const WithdrawalAddressModel: Model<WithdrawalAddressDoc> =
  (mongoose.models.WithdrawalAddress as Model<WithdrawalAddressDoc>) ??
  mongoose.model<WithdrawalAddressDoc>('WithdrawalAddress', schema);

/** When a record becomes eligible for withdrawals (its last change + the cooldown). */
export function withdrawableAt(rec: WithdrawalAddressDoc): Date {
  return new Date(rec.updatedAt.getTime() + withdrawalAddressCooldownMs());
}

/**
 * Register or change a player's withdrawal address. A change resets the cooldown (mongoose bumps
 * updatedAt); re-registering the SAME address is a no-op so it can't be abused to keep the cooldown
 * fresh or to reset someone else's. Returns the current record.
 */
export async function setWithdrawalAddress(playerId: string, address: string): Promise<WithdrawalAddressDoc> {
  const existing = await WithdrawalAddressModel.findById(playerId);
  if (existing && existing.address === address) return existing; // unchanged — cooldown not restarted
  await WithdrawalAddressModel.updateOne({ _id: playerId }, { $set: { address } }, { upsert: true });
  return (await WithdrawalAddressModel.findById(playerId))!;
}

export async function getWithdrawalAddress(playerId: string): Promise<WithdrawalAddressDoc | null> {
  return WithdrawalAddressModel.findById(playerId).lean();
}

export class WithdrawalAddressError extends Error {
  constructor(
    message: string,
    public readonly withdrawableAt?: Date,
  ) {
    super(message);
    this.name = 'WithdrawalAddressError';
  }
}

/**
 * Throw unless `address` is the player's registered withdrawal address AND its cooldown has elapsed.
 * Called on the withdrawal-request path — this is what enforces the 48h rule.
 */
export async function assertWithdrawableAddress(playerId: string, address: string): Promise<void> {
  const rec = await getWithdrawalAddress(playerId);
  if (!rec) {
    throw new WithdrawalAddressError('no withdrawal address is set — register one first');
  }
  if (rec.address !== address) {
    throw new WithdrawalAddressError('withdrawals may only be sent to your registered withdrawal address');
  }
  const eligible = withdrawableAt(rec);
  if (Date.now() < eligible.getTime()) {
    throw new WithdrawalAddressError(
      `withdrawal address was changed recently — withdrawals to it open at ${eligible.toISOString()} (48h cooldown)`,
      eligible,
    );
  }
}
