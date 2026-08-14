import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha256';
import { base58 } from '@scure/base';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/**
 * TRC-20 withdrawal signer — the on-chain leg of a withdrawal.
 *
 * This is the ONE place the platform holds a private key online: the hot wallet that withdrawals are
 * paid FROM. (Deposit addresses are derived from a public xpub only — see tron-address.ts — so no
 * secret is ever needed there. Withdrawals must sign, so a hot key is unavoidable; keep it small and
 * refill from cold storage.)
 *
 * We do NOT serialize the transaction ourselves: TronGrid's `triggersmartcontract` builds the
 * `raw_data` and the `txID` (which is sha256(raw_data)). We sign that txID with secp256k1 — the same
 * curve the address code uses — and broadcast. That keeps the risky protobuf serialization on
 * TronGrid and the signing (the only part that needs the secret) local.
 *
 * Network-agnostic: mainnet and the Nile/Shasta testnets share the address format and this RPC
 * shape; only the API URL + USDT contract differ (config/chain.ts), so the switch to mainnet is env.
 */

const TRON_PREFIX = 0x41;
/** USDT (TRC-20) has 6 decimals — the smallest on-chain unit is a millionth. */
const USDT_DECIMALS = 6;

interface TronTx {
  txID: string;
  raw_data: unknown;
  raw_data_hex: string;
  [k: string]: unknown;
}

export interface SignerConfig {
  /** e.g. https://nile.trongrid.io (testnet) or https://api.trongrid.io (mainnet). */
  apiUrl: string;
  apiKey: string;
  /** USDT TRC-20 contract, base58. */
  contractAddress: string;
  /** Hot-wallet private key (hex, 32 bytes). The only online secret. */
  privateKeyHex: string;
  /** fee_limit in SUN (1 TRX = 1e6). A USDT transfer needs energy/bandwidth; 100 TRX is safe. */
  feeLimitSun?: number;
  fetchImpl?: typeof fetch;
}

/** A base58check TRON address → its 21-byte hex (0x41 ‖ 20-byte body). */
export function addressToHex(base58Addr: string): string {
  const decoded = base58.decode(base58Addr);
  if (decoded.length !== 25 || decoded[0] !== TRON_PREFIX) {
    throw new Error(`not a TRON address: ${base58Addr}`);
  }
  return bytesToHex(decoded.slice(0, 21));
}

/** The hot wallet's own address (hex + base58), derived from its private key. */
export function addressFromPrivateKey(privateKeyHex: string): { hex: string; base58: string } {
  const priv = hexToBytes(privateKeyHex.replace(/^0x/, ''));
  const pub = secp256k1.getPublicKey(priv, false); // uncompressed: 0x04 ‖ X ‖ Y
  const body = keccak_256(pub.slice(1)).slice(-20);
  const addr = new Uint8Array(21);
  addr[0] = TRON_PREFIX;
  addr.set(body, 1);
  const checksum = sha256(sha256(addr)).slice(0, 4);
  const full = new Uint8Array(25);
  full.set(addr, 0);
  full.set(checksum, 21);
  return { hex: bytesToHex(addr), base58: base58.encode(full) };
}

/** ABI-encode `transfer(address to, uint256 amount)` — two 32-byte words, hex. */
export function encodeTransfer(toBase58: string, amountUnits: bigint): string {
  const to20 = addressToHex(toBase58).slice(2); // drop the 0x41 version byte → 20-byte body
  const toWord = to20.padStart(64, '0');
  const amountWord = amountUnits.toString(16).padStart(64, '0');
  return toWord + amountWord;
}

/** A USDT decimal string ("20.00") → on-chain integer units (6 decimals), exact. */
export function usdtToUnits(decimal: string): bigint {
  const [wholePart, frac = ''] = decimal.trim().split('.');
  const whole = wholePart ?? '0';
  const fracPadded = (frac + '0'.repeat(USDT_DECIMALS)).slice(0, USDT_DECIMALS);
  return BigInt(whole) * 10n ** BigInt(USDT_DECIMALS) + BigInt(fracPadded);
}

/**
 * Build → sign → broadcast a USDT transfer from the hot wallet. Returns the on-chain txID.
 * Throws if TronGrid rejects the build or the broadcast (caller rolls the withdrawal back).
 */
export async function signAndBroadcastTransfer(
  cfg: SignerConfig,
  toBase58: string,
  amountUnits: bigint,
): Promise<string> {
  const doFetch = cfg.fetchImpl ?? fetch;
  const base = cfg.apiUrl.replace(/\/+$/, '');
  const owner = addressFromPrivateKey(cfg.privateKeyHex);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers['TRON-PRO-API-KEY'] = cfg.apiKey;

  // 1. TronGrid builds the unsigned transaction (raw_data + txID). visible:false → hex addresses.
  const buildRes = await doFetch(`${base}/wallet/triggersmartcontract`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      owner_address: owner.hex,
      contract_address: addressToHex(cfg.contractAddress),
      function_selector: 'transfer(address,uint256)',
      parameter: encodeTransfer(toBase58, amountUnits),
      fee_limit: cfg.feeLimitSun ?? 100_000_000,
      call_value: 0,
      visible: false,
    }),
  });
  const built = (await buildRes.json()) as { transaction?: TronTx; result?: { message?: string } };
  if (!built.transaction?.txID) {
    throw new Error(`tron build failed: ${decodeHexMessage(built.result?.message) || JSON.stringify(built)}`);
  }
  const tx = built.transaction;

  // 2. Sign the txID (sha256 of raw_data) locally — the only step that needs the secret.
  const priv = cfg.privateKeyHex.replace(/^0x/, '');
  const sig = secp256k1.sign(tx.txID, priv);
  const signatureHex = bytesToHex(sig.toCompactRawBytes()) + (sig.recovery === 1 ? '01' : '00');

  // 3. Broadcast the signed transaction.
  const bcRes = await doFetch(`${base}/wallet/broadcasttransaction`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...tx, signature: [signatureHex] }),
  });
  const bc = (await bcRes.json()) as { result?: boolean; txid?: string; code?: string; message?: string };
  if (!bc.result) {
    throw new Error(`tron broadcast rejected: ${bc.code ?? ''} ${decodeHexMessage(bc.message)}`.trim());
  }
  return tx.txID;
}

/** TronGrid error messages come back hex-encoded; decode for a readable failure reason. */
function decodeHexMessage(message: string | undefined): string {
  if (!message) return '';
  try {
    return new TextDecoder().decode(hexToBytes(message));
  } catch {
    return message;
  }
}
