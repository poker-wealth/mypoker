import { createHash, createPrivateKey, createPublicKey, sign as edSign } from 'node:crypto';
import type { ChainClient, CommitRootArgs } from './chain';

/**
 * SolanaChainClient — the real L1 notary (FairPlay v6.0 §6, step 6b).
 *
 * Commits each batch's Merkle root to Solana as a Memo transaction, so the
 * verification page's step 6b — "Solana Explorer: on-chain Root matches
 * merkle_root. Query chain. Permanent record." — has a transaction to point
 * at. Devnet now, mainnet at launch, per the plan (W3 parallel track).
 *
 * Deliberately dependency-free: plain JSON-RPC over fetch, ed25519 signing via
 * node:crypto, and the little pieces Solana needs (base58, compact-u16, legacy
 * message serialization) hand-rolled below and unit-tested against known
 * vectors. @solana/web3.js would drag in more surface than this file replaces.
 *
 * Iron rule 2 still governs: nothing here is ever awaited in the deal path.
 * The aggregator calls it off-hand, and the ResilientChainClient wraps it so a
 * sick chain degrades to L2/L3 instead of stalling anything.
 */

// ── base58 (Bitcoin alphabet — what Solana uses everywhere) ──────────────────

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_INDEX = new Map([...B58].map((c, i) => [c, BigInt(i)]));

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  // Leading zero bytes encode as leading '1's — dropping them changes the key.
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out || '1';
}

export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const v = B58_INDEX.get(c);
    if (v === undefined) throw new Error(`not base58: ${c}`);
    n = n * 58n + v;
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== '1') break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

// ── compact-u16 (Solana's short-vec length prefix) ───────────────────────────

export function compactU16(value: number): Uint8Array {
  const out: number[] = [];
  let rest = value;
  for (;;) {
    const byte = rest & 0x7f;
    rest >>= 7;
    if (rest === 0) {
      out.push(byte);
      return new Uint8Array(out);
    }
    out.push(byte | 0x80);
  }
}

// ── ed25519 via node:crypto (seed → KeyObjects, no SDK) ──────────────────────

/** PKCS8 DER prefix that turns a raw 32-byte ed25519 seed into an importable key. */
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export interface SolanaKeypair {
  publicKey: Uint8Array; // 32 bytes
  sign(message: Uint8Array): Uint8Array; // 64 bytes
}

/**
 * Accepts the standard `solana-keygen` file format: a JSON array of 64 bytes
 * (32-byte seed ‖ 32-byte public key). Only the seed is trusted — the public
 * key is re-derived, so a corrupted file fails loudly instead of signing with
 * a key that does not match its claimed address.
 */
export function keypairFromJson(json: string): SolanaKeypair {
  const raw = JSON.parse(json) as number[];
  if (!Array.isArray(raw) || raw.length < 32) throw new Error('bad keypair file');
  const seed = Buffer.from(raw.slice(0, 32));

  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const publicKey = new Uint8Array(spki.subarray(spki.length - 32));

  if (raw.length === 64) {
    const claimed = Buffer.from(raw.slice(32));
    if (!claimed.equals(Buffer.from(publicKey))) {
      throw new Error('keypair file public key does not match its seed');
    }
  }

  return {
    publicKey,
    sign: (message) => new Uint8Array(edSign(null, message, privateKey)),
  };
}

// ── legacy transaction serialization (one signer, one Memo instruction) ──────

/** The SPL Memo program — the canonical place to put small permanent notes. */
export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

/**
 * The message bytes for a single-signer Memo transaction. Exported separately
 * from signing so tests can pin the serialization against a known-good vector
 * without a key.
 */
export function buildMemoMessage(
  signerPubkey: Uint8Array,
  recentBlockhash: string,
  memo: string,
): Uint8Array {
  const memoBytes = new TextEncoder().encode(memo);
  const parts: Uint8Array[] = [
    new Uint8Array([1, 0, 1]), // 1 required signature, 0 readonly signed, 1 readonly unsigned
    compactU16(2), // two account keys:
    signerPubkey, //   [0] fee payer (signer, writable)
    base58Decode(MEMO_PROGRAM_ID), //   [1] the Memo program (readonly)
    base58Decode(recentBlockhash),
    compactU16(1), // one instruction:
    new Uint8Array([1]), //   program id index → Memo
    compactU16(0), //   no instruction accounts
    compactU16(memoBytes.length),
    memoBytes,
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function buildSignedTransaction(keypair: SolanaKeypair, message: Uint8Array): Uint8Array {
  const signature = keypair.sign(message);
  const count = compactU16(1);
  const out = new Uint8Array(count.length + 64 + message.length);
  out.set(count, 0);
  out.set(signature, count.length);
  out.set(message, count.length + 64);
  return out;
}

/** The memo body: everything step 6b needs to match against the round data. */
export const memoFor = (args: CommitRootArgs): string =>
  `fairplay:v1:${args.merkleRoot}:${args.roundCount}:${args.fromRoundId}:${args.toRoundId}`;

// ── the client ───────────────────────────────────────────────────────────────

interface RpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

export class SolanaChainClient implements ChainClient {
  constructor(
    private readonly rpcUrl: string,
    private readonly keypair: SolanaKeypair,
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await this.doFetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`solana rpc ${method}: HTTP ${res.status}`);
    const body = (await res.json()) as RpcResponse<T>;
    if (body.error) throw new Error(`solana rpc ${method}: ${body.error.message}`);
    if (body.result === undefined) throw new Error(`solana rpc ${method}: empty result`);
    return body.result;
  }

  async getLatestBlockNumber(): Promise<number> {
    return this.rpc<number>('getSlot', [{ commitment: 'confirmed' }]);
  }

  async getBlockHash(blockNumber: number): Promise<string> {
    const block = await this.rpc<{ blockhash: string }>('getBlock', [
      blockNumber,
      { transactionDetails: 'none', rewards: false, maxSupportedTransactionVersion: 0 },
    ]);
    return block.blockhash;
  }

  async commitMerkleRoot(args: CommitRootArgs): Promise<string> {
    const { value } = await this.rpc<{ value: { blockhash: string } }>('getLatestBlockhash', [
      { commitment: 'confirmed' },
    ]);

    const message = buildMemoMessage(this.keypair.publicKey, value.blockhash, memoFor(args));
    const tx = buildSignedTransaction(this.keypair, message);

    // The returned signature IS the explorer link's path segment — what the
    // verification page hands to the player for 6b.
    return this.rpc<string>('sendTransaction', [
      Buffer.from(tx).toString('base64'),
      { encoding: 'base64', preflightCommitment: 'confirmed' },
    ]);
  }
}

/** Deterministic address string for logs — never used for signing. */
export const addressOf = (keypair: SolanaKeypair): string => base58Encode(keypair.publicKey);

/** Convenience: sha256 hex, used by tests pinning the serialization. */
export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');
