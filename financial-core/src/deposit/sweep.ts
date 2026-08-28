import { HDKey } from '@scure/bip32';
import { bytesToHex } from '@noble/hashes/utils';
import { DepositAddressModel } from '../wallet/deposit-address';
import { SweepStateModel } from './sweep-state.model';
import { usdtToUnits } from '../withdrawal/tron-signer';
import {
  accountXprv,
  treasurySweepAddress,
  sweepMinUsdt,
  sweepGasSun,
  sweepCooldownMs,
  sweepPollMs,
} from '../config/chain';

/**
 * The sweep — consolidating deposits from per-player addresses into the treasury.
 *
 * A deposit lands at the player's own address. This walks those addresses and, for any holding real
 * USDT, moves the whole balance to the treasury. Because a TRC-20 transfer costs TRX for energy, an
 * address with none is GASSED first (a small TRX drip) and swept on a later pass. Every action sets
 * a per-address cooldown so an in-flight transaction is never sent twice — sending a full-balance
 * sweep twice is a double-spend attempt, so that guard is load-bearing.
 *
 * The chain is behind {@link SweepChain} so the DECISIONS here (skip dust, gas-up, sweep) are
 * unit-tested with a fake, and only the thin TronGrid adapter (sweep-chain.ts) talks to the network.
 * This module never credits or debits a ledger: the player was credited when they deposited; the
 * sweep only moves custody on-chain and changes no one's balance.
 */

export interface SweepChain {
  /** On-chain USDT balance of an address, in token units (6 dp). */
  usdtBalanceUnits(address: string): Promise<bigint>;
  /** On-chain TRX balance of an address, in SUN. */
  trxBalanceSun(address: string): Promise<bigint>;
  /** Send TRX from the gas wallet to `toAddress`. Returns the txID. */
  dripGas(toAddress: string, amountSun: bigint): Promise<string>;
  /** Sign+broadcast a USDT transfer FROM `fromPrivateKeyHex`'s address to `toAddress`. Returns the txID. */
  sweepUsdt(fromPrivateKeyHex: string, toAddress: string, amountUnits: bigint): Promise<string>;
}

/** The deposit branch of the BIP-44 tree — must match wallet/tron-address.ts. */
const PLAYER_BRANCH = 5;

/**
 * The private key for a player deposit address, derived from the account xprv.
 * `m/44'/195'/0'` (the xprv) → `/5/{index}`. Non-hardened, so this yields the exact key for the
 * address wallet/tron-address.ts derives from the matching xpub.
 */
export function deriveDepositPrivateKey(xprv: string, index: number): string {
  const account = HDKey.fromExtendedKey(xprv);
  const child = account.deriveChild(PLAYER_BRANCH).deriveChild(index);
  if (!child.privateKey) throw new Error('account xprv produced no private key — is it an xprv, not an xpub?');
  return bytesToHex(child.privateKey);
}

/** token units (6 dp) → a decimal string, for logging/audit only. */
function unitsToDecimal(units: bigint): string {
  const s = units.toString().padStart(7, '0');
  return `${s.slice(0, -6)}.${s.slice(-6)}`;
}

export interface SweepResult {
  scanned: number;
  gassed: number;
  swept: number;
}

/** One pass over every deposit address. Idempotent within the cooldown; safe to call repeatedly. */
export async function sweepOnce(chain: SweepChain, now: Date = new Date()): Promise<SweepResult> {
  const treasury = treasurySweepAddress();
  const xprv = accountXprv();
  if (!xprv || !treasury) return { scanned: 0, gassed: 0, swept: 0 }; // not configured

  const minUnits = usdtToUnits(sweepMinUsdt());
  const gasSun = BigInt(sweepGasSun());
  const cooldownMs = sweepCooldownMs();

  const addresses = await DepositAddressModel.find().lean();
  let gassed = 0;
  let swept = 0;

  for (const rec of addresses) {
    // Cooldown — leave an address alone while its last action is still confirming.
    const state = await SweepStateModel.findById(rec.address).lean();
    if (state && now.getTime() - state.lastActionAt.getTime() < cooldownMs) continue;

    let usdt: bigint;
    try {
      usdt = await chain.usdtBalanceUnits(rec.address);
    } catch (err) {
      console.error(`[sweep] balance check failed for ${rec.address}:`, (err as Error).message);
      continue;
    }
    if (usdt < minUnits) continue; // empty or dust — not worth the gas

    let trx: bigint;
    try {
      trx = await chain.trxBalanceSun(rec.address);
    } catch (err) {
      console.error(`[sweep] trx check failed for ${rec.address}:`, (err as Error).message);
      continue;
    }

    // No gas to move the token → drip TRX and sweep on a later pass.
    if (trx < gasSun) {
      try {
        const txid = await chain.dripGas(rec.address, gasSun);
        await recordState(rec.address, 'gas', txid, undefined, now);
        gassed++;
        console.log(`[sweep] gassed ${rec.address} (${txid})`);
      } catch (err) {
        console.error(`[sweep] gas drip failed for ${rec.address}:`, (err as Error).message);
      }
      continue;
    }

    // Sweep the whole balance to the treasury.
    try {
      const priv = deriveDepositPrivateKey(xprv, rec.index);
      const txid = await chain.sweepUsdt(priv, treasury, usdt);
      await recordState(rec.address, 'sweep', txid, unitsToDecimal(usdt), now);
      swept++;
      console.log(`[sweep] swept ${unitsToDecimal(usdt)} USDT from ${rec.address} → treasury (${txid})`);
    } catch (err) {
      console.error(`[sweep] sweep failed for ${rec.address}:`, (err as Error).message);
    }
  }

  return { scanned: addresses.length, gassed, swept };
}

async function recordState(
  address: string,
  action: 'gas' | 'sweep',
  txHash: string,
  amount: string | undefined,
  now: Date,
): Promise<void> {
  await SweepStateModel.updateOne(
    { _id: address },
    {
      $set: {
        lastAction: action,
        lastTxHash: txHash,
        lastActionAt: now,
        ...(amount !== undefined ? { lastAmount: amount } : {}),
      },
    },
    { upsert: true },
  );
}

/** Poll forever on the configured interval. Returns a stop handle. */
export function runSweeper(chain: SweepChain, pollMs: number = sweepPollMs()): { stop: () => void } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await sweepOnce(chain);
    } catch (err) {
      console.error('[sweep] pass failed:', (err as Error).message);
    }
    if (!stopped) timer = setTimeout(() => void tick(), pollMs);
  };

  void tick();
  return {
    stop: (): void => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
