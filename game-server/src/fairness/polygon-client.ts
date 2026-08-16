import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { ChainClient, CommitRootArgs } from './chain';

/**
 * Polygon L2 notary — Layer 2 of the resilience ladder (v6.0 §4/§6.2). When Solana is unhealthy the
 * batch's Merkle root is anchored on Polygon: a data-carrying transaction from the notary wallet to
 * itself with the root as calldata, so the root is provably on-chain at a block height. Only
 * `commitMerkleRoot` is exercised by the ladder (randomness always reads from the primary chain).
 *
 * The transaction is a legacy (EIP-155) EVM tx built + signed here with @noble — RLP encoding and
 * signing are pure and unit-tested (a signed tx recovers to the sender address). The JSON-RPC calls
 * (nonce, gas price, broadcast) are the only untestable part and sit behind the injectable `rpc`.
 */

export interface EvmRpc {
  call(method: string, params: unknown[]): Promise<unknown>;
}

/** Minimal big-endian byte encoding with no leading zeros (RLP's integer form). */
function toMinimalBytes(v: bigint): Uint8Array {
  if (v === 0n) return new Uint8Array(0);
  let hex = v.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return hexToBytes(hex);
}
function concat(...arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function rlpLen(len: number, offset: number): Uint8Array {
  if (len < 56) return Uint8Array.of(offset + len);
  const lb = toMinimalBytes(BigInt(len));
  return concat(Uint8Array.of(offset + 55 + lb.length), lb);
}
/** RLP-encode a byte string. */
export function rlpBytes(b: Uint8Array): Uint8Array {
  if (b.length === 1 && b[0]! < 0x80) return b;
  return concat(rlpLen(b.length, 0x80), b);
}
/** RLP-encode a list of already-encoded items. */
export function rlpList(items: Uint8Array[]): Uint8Array {
  const body = concat(...items);
  return concat(rlpLen(body.length, 0xc0), body);
}

/** The EVM address (0x-hex, 20 bytes) for a secp256k1 private key. */
export function evmAddress(privateKeyHex: string): string {
  const pub = secp256k1.getPublicKey(hexToBytes(privateKeyHex.replace(/^0x/, '')), false); // 0x04‖X‖Y
  return `0x${bytesToHex(keccak_256(pub.slice(1)).slice(-20))}`;
}

export interface LegacyTx {
  nonce: bigint;
  gasPrice: bigint;
  gasLimit: bigint;
  to: string; // 0x-hex, 20 bytes
  value: bigint;
  data: Uint8Array;
  chainId: number;
}

function txBase(tx: LegacyTx): Uint8Array[] {
  return [
    rlpBytes(toMinimalBytes(tx.nonce)),
    rlpBytes(toMinimalBytes(tx.gasPrice)),
    rlpBytes(toMinimalBytes(tx.gasLimit)),
    rlpBytes(hexToBytes(tx.to.replace(/^0x/, ''))),
    rlpBytes(toMinimalBytes(tx.value)),
    rlpBytes(tx.data),
  ];
}

/** The keccak-256 hash a node recovers the sender from — RLP of the tx fields ‖ chainId, 0, 0 (EIP-155). */
export function legacyTxSigningHash(tx: LegacyTx): Uint8Array {
  return keccak_256(
    rlpList([
      ...txBase(tx),
      rlpBytes(toMinimalBytes(BigInt(tx.chainId))),
      rlpBytes(new Uint8Array(0)),
      rlpBytes(new Uint8Array(0)),
    ]),
  );
}

/** Sign a legacy (EIP-155) transaction; returns the raw signed tx, its hash, and the sig components. */
export function signLegacyTx(
  tx: LegacyTx,
  privateKeyHex: string,
): { raw: Uint8Array; hash: string; r: bigint; s: bigint; recovery: number } {
  const sig = secp256k1.sign(legacyTxSigningHash(tx), privateKeyHex.replace(/^0x/, ''));
  const v = BigInt(sig.recovery) + BigInt(tx.chainId) * 2n + 35n;
  const raw = rlpList([
    ...txBase(tx),
    rlpBytes(toMinimalBytes(v)),
    rlpBytes(toMinimalBytes(sig.r)),
    rlpBytes(toMinimalBytes(sig.s)),
  ]);
  return { raw, hash: `0x${bytesToHex(keccak_256(raw))}`, r: sig.r, s: sig.s, recovery: sig.recovery };
}

export class PolygonChainClient implements ChainClient {
  private readonly address: string;
  constructor(
    private readonly rpc: EvmRpc,
    private readonly privateKeyHex: string,
    private readonly chainId: number,
    private readonly gasLimit: bigint = 100_000n,
  ) {
    this.address = evmAddress(privateKeyHex);
  }

  async getLatestBlockNumber(): Promise<number> {
    return Number(BigInt(String(await this.rpc.call('eth_blockNumber', []))));
  }
  async getBlockHash(blockNumber: number): Promise<string> {
    const block = (await this.rpc.call('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, false])) as
      | { hash?: string }
      | null;
    if (!block?.hash) throw new Error(`polygon: no block ${blockNumber}`);
    return block.hash;
  }

  /** Anchor the Merkle root on Polygon: a data-carrying tx from the notary wallet to itself. */
  async commitMerkleRoot(args: CommitRootArgs): Promise<string> {
    const nonce = BigInt(String(await this.rpc.call('eth_getTransactionCount', [this.address, 'pending'])));
    const gasPrice = BigInt(String(await this.rpc.call('eth_gasPrice', [])));
    const tx = signLegacyTx(
      {
        nonce,
        gasPrice,
        gasLimit: this.gasLimit,
        to: this.address,
        value: 0n,
        data: hexToBytes(args.merkleRoot.replace(/^0x/, '')),
        chainId: this.chainId,
      },
      this.privateKeyHex,
    );
    const sent = await this.rpc.call('eth_sendRawTransaction', [`0x${bytesToHex(tx.raw)}`]);
    return String(sent);
  }
}

/** The untestable boundary: a fetch-based Ethereum JSON-RPC caller. */
export function httpEvmRpc(url: string): EvmRpc {
  let id = 0;
  return {
    async call(method, params) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      });
      if (!res.ok) throw new Error(`polygon rpc ${method} → ${res.status}`);
      const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (body.error) throw new Error(`polygon rpc ${method}: ${body.error.message ?? 'error'}`);
      return body.result;
    },
  };
}
