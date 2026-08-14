import mongoose, { Schema, type Model } from 'mongoose';
import { usdtContract } from '../config/chain';
import { tronAddressFromXpub } from './tron-address';
import { playerDepositPath } from './hd-derivation';
import { evaluateCB7 } from '../circuit-breakers/breakers';
import { AccountType } from '../domain/account-types';

/**
 * Per-player TRC-20 deposit addresses.
 *
 * Each player gets one permanent BIP-44 index (`m/44'/195'/0'/5/{index}`) and the
 * address derived from it. This lives in its own collections — NOT on the money
 * `accounts` document, whose balance fields may only ever be written by
 * transfer()/the withdrawal machine (spec §3.2). An address mapping is not money,
 * so it stays off that schema.
 *
 * The address is derived from the account-level PUBLIC xpub (TRON_ACCOUNT_XPUB);
 * no secret is involved (see tron-address.ts). Unset xpub → no address yet, which
 * the caller surfaces as "deposits open once the chain is provisioned".
 */

interface CounterDoc {
  _id: string;
  seq: number;
}
const counterSchema = new Schema<CounterDoc>(
  { _id: { type: String }, seq: { type: Number, required: true, default: 0 } },
  { versionKey: false },
);
const DepositCounterModel: Model<CounterDoc> =
  (mongoose.models.DepositCounter as Model<CounterDoc>) ??
  mongoose.model<CounterDoc>('DepositCounter', counterSchema);

interface DepositAddressDoc {
  _id: string; // playerId
  index: number;
  address: string;
  createdAt: Date;
}
const depositAddressSchema = new Schema<DepositAddressDoc>(
  {
    _id: { type: String },
    index: { type: Number, required: true },
    address: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
export const DepositAddressModel: Model<DepositAddressDoc> =
  (mongoose.models.DepositAddress as Model<DepositAddressDoc>) ??
  mongoose.model<DepositAddressDoc>('DepositAddress', depositAddressSchema);

const INDEX_COUNTER = 'playerDepositIndex';

export interface DepositAddress {
  address: string;
  network: 'TRC20';
  /** The one USDT contract the platform credits from — shown so users don't send the wrong token. */
  contract: string;
}

/**
 * The player's permanent TRC-20 deposit address, or `null` when the account xpub
 * isn't provisioned. The mapping is assigned once and reused forever, so a player
 * always sees the same address and a returning deposit lands correctly.
 */
export async function getDepositAddress(playerId: string): Promise<DepositAddress | null> {
  const xpub = process.env.TRON_ACCOUNT_XPUB?.trim();
  if (!xpub) return null;

  const existing = await DepositAddressModel.findById(playerId).lean();
  if (existing) {
    return { address: existing.address, network: 'TRC20', contract: usdtContract() };
  }

  // Reserve the next index atomically. If two first-requests race, each reserves
  // its own index but the unique _id below lets exactly one mapping persist.
  const counter = await DepositCounterModel.findByIdAndUpdate(
    INDEX_COUNTER,
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  const index = counter!.seq;
  const address = tronAddressFromXpub(xpub, index);

  // CB7 — the one HD-derivation path that runs live (player deposit addresses). Verify the BIP-44
  // branch matches the PLAYER account type BEFORE the address is ever persisted or shown; a mismatch
  // means the derivation constants have drifted and a deposit could land under the wrong pool
  // (spec §3.4). On a happy path this is two string ops and no DB write; on a trip it writes the
  // security_log + ops alert and we refuse to hand out the address.
  const cb7 = await evaluateCB7(AccountType.PLAYER, playerDepositPath(index));
  if (cb7.tripped) {
    throw new Error('deposit address derivation failed the CB7 address-mapping check');
  }

  try {
    await DepositAddressModel.create({ _id: playerId, index, address });
    return { address, network: 'TRC20', contract: usdtContract() };
  } catch {
    // Lost the race — the winner's address is authoritative.
    const winner = await DepositAddressModel.findById(playerId).lean();
    if (winner) return { address: winner.address, network: 'TRC20', contract: usdtContract() };
    throw new Error('deposit address assignment failed');
  }
}
