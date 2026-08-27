import {
  signAndBroadcastTransfer,
  LocalPrivateKeySigner,
  addressToHex,
  type SignerConfig,
} from '../withdrawal/tron-signer';
import {
  tronApiUrl,
  tronApiKey,
  usdtContract,
  withdrawalFeeLimitSun,
  sweepGasWalletKey,
} from '../config/chain';
import type { SweepChain } from './sweep';

/**
 * The live sweep chain — the ONLY part of the sweep that talks to TronGrid.
 *
 * Reads balances (constant calls, no gas), drips TRX to gas up an address, and signs+broadcasts the
 * USDT transfer out of it. The signing reuses the withdrawal signer: a per-address key produces a
 * LocalPrivateKeySigner, and the same build→sign→broadcast path moves the token. Kept behind the
 * SweepChain port so sweep.ts's decisions are testable without a network.
 */

function headersFor(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', ...(apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {}) };
}

/** balanceOf(address) via a constant contract call → token units (6 dp). */
async function usdtBalanceUnits(base: string, apiKey: string, contract: string, address: string): Promise<bigint> {
  const res = await fetch(`${base}/wallet/triggerconstantcontract`, {
    method: 'POST',
    headers: headersFor(apiKey),
    body: JSON.stringify({
      owner_address: addressToHex(address),
      contract_address: addressToHex(contract),
      function_selector: 'balanceOf(address)',
      // 20-byte address body (drop the 0x41 version byte) left-padded to a 32-byte word.
      parameter: addressToHex(address).slice(2).padStart(64, '0'),
      visible: false,
    }),
  });
  if (!res.ok) throw new Error(`TronGrid ${res.status} on balanceOf ${address}`);
  const body = (await res.json()) as { constant_result?: string[] };
  const hex = body.constant_result?.[0];
  return hex ? BigInt(`0x${hex}`) : 0n;
}

/** getaccount → TRX balance in SUN (0 for an unactivated address). */
async function trxBalanceSun(base: string, apiKey: string, address: string): Promise<bigint> {
  const res = await fetch(`${base}/wallet/getaccount`, {
    method: 'POST',
    headers: headersFor(apiKey),
    body: JSON.stringify({ address: addressToHex(address), visible: false }),
  });
  if (!res.ok) throw new Error(`TronGrid ${res.status} on getaccount ${address}`);
  const body = (await res.json()) as { balance?: number };
  return BigInt(body.balance ?? 0);
}

/** Plain TRX transfer from the gas wallet — build → sign → broadcast. Returns the txID. */
async function sendTrx(base: string, apiKey: string, gasKey: string, toAddress: string, amountSun: bigint): Promise<string> {
  const signer = new LocalPrivateKeySigner(gasKey);
  const owner = await signer.address();
  const headers = headersFor(apiKey);

  const buildRes = await fetch(`${base}/wallet/createtransaction`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      owner_address: owner.hex,
      to_address: addressToHex(toAddress),
      amount: Number(amountSun),
      visible: false,
    }),
  });
  const tx = (await buildRes.json()) as { txID?: string; [k: string]: unknown };
  if (!tx.txID) throw new Error(`trx build failed: ${JSON.stringify(tx)}`);

  const signature = await signer.signTxId(tx.txID);
  const bcRes = await fetch(`${base}/wallet/broadcasttransaction`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...tx, signature: [signature] }),
  });
  const bc = (await bcRes.json()) as { result?: boolean; code?: string; message?: string };
  if (!bc.result) throw new Error(`trx broadcast rejected: ${bc.code ?? ''} ${bc.message ?? ''}`.trim());
  return tx.txID;
}

/** The production sweep chain, reading its config at call time. */
export function tronGridSweepChain(): SweepChain {
  const base = tronApiUrl();
  const apiKey = tronApiKey();
  const contract = usdtContract();
  const feeLimitSun = withdrawalFeeLimitSun();

  return {
    usdtBalanceUnits: (address) => usdtBalanceUnits(base, apiKey, contract, address),
    trxBalanceSun: (address) => trxBalanceSun(base, apiKey, address),
    dripGas: (toAddress, amountSun): Promise<string> => {
      const gasKey = sweepGasWalletKey();
      if (!gasKey) {
        throw new Error('no sweep gas wallet — set SWEEP_GAS_WALLET_KEY or TRON_HOT_WALLET_KEY');
      }
      return sendTrx(base, apiKey, gasKey, toAddress, amountSun);
    },
    sweepUsdt: (fromPrivateKeyHex, toAddress, amountUnits): Promise<string> => {
      const cfg: SignerConfig = {
        apiUrl: base,
        apiKey,
        contractAddress: contract,
        signer: new LocalPrivateKeySigner(fromPrivateKeyHex),
        feeLimitSun,
      };
      return signAndBroadcastTransfer(cfg, toAddress, amountUnits);
    },
  };
}
