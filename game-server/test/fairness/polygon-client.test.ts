import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';
import {
  rlpBytes,
  rlpList,
  evmAddress,
  signLegacyTx,
  legacyTxSigningHash,
  PolygonChainClient,
  type EvmRpc,
  type LegacyTx,
} from '../../src/fairness/polygon-client';

const KEY = 'da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0';

describe('Polygon client', () => {
  it('RLP-encodes to the canonical vectors', () => {
    // Single low byte encodes as itself; empty string is 0x80.
    expect([...rlpBytes(Uint8Array.of(0x7f))]).toEqual([0x7f]);
    expect([...rlpBytes(new Uint8Array(0))]).toEqual([0x80]);
    // ["cat","dog"] → 0xc8 0x83 636174 0x83 646f67
    const cat = rlpBytes(Uint8Array.from(Buffer.from('cat')));
    const dog = rlpBytes(Uint8Array.from(Buffer.from('dog')));
    expect(bytesToHex(rlpList([cat, dog]))).toBe('c88363617483646f67');
  });

  it('derives a checksum-less EVM address deterministically', () => {
    expect(evmAddress(KEY)).toMatch(/^0x[0-9a-f]{40}$/);
    expect(evmAddress(`0x${KEY}`)).toBe(evmAddress(KEY));
  });

  it('signs a legacy tx that RECOVERS to the sender address (what a node checks)', () => {
    const tx: LegacyTx = {
      nonce: 7n,
      gasPrice: 30_000_000_000n,
      gasLimit: 100_000n,
      to: evmAddress(KEY),
      value: 0n,
      data: Uint8Array.from(Buffer.from('a'.repeat(64), 'hex')), // a 32-byte merkle root
      chainId: 137, // Polygon mainnet
    };
    const { r, s, recovery, hash } = signLegacyTx(tx, KEY);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

    const sig = secp256k1.Signature.fromCompact(
      bytesToHex(concat32(r)) + bytesToHex(concat32(s)),
    ).addRecoveryBit(recovery);
    const pub = sig.recoverPublicKey(bytesToHex(legacyTxSigningHash(tx))).toRawBytes(false);
    const recovered = `0x${bytesToHex(keccak_256(pub.slice(1)).slice(-20))}`;
    expect(recovered).toBe(evmAddress(KEY));
  });

  it('commitMerkleRoot builds nonce/gas from RPC and broadcasts the signed tx', async () => {
    const calls: { method: string; params: unknown[] }[] = [];
    const rpc: EvmRpc = {
      async call(method, params) {
        calls.push({ method, params });
        if (method === 'eth_getTransactionCount') return '0x5';
        if (method === 'eth_gasPrice') return '0x6fc23ac00';
        if (method === 'eth_sendRawTransaction') return '0xdeadbeeftxhash';
        return null;
      },
    };
    const client = new PolygonChainClient(rpc, KEY, 137);
    const tx = await client.commitMerkleRoot({
      merkleRoot: 'b'.repeat(64),
      roundCount: 100,
      fromRoundId: 'r1',
      toRoundId: 'r100',
    });
    expect(tx).toBe('0xdeadbeeftxhash');
    expect(calls.map((c) => c.method)).toEqual([
      'eth_getTransactionCount',
      'eth_gasPrice',
      'eth_sendRawTransaction',
    ]);
    // The broadcast payload is a 0x-hex raw tx.
    expect(calls[2]!.params[0]).toMatch(/^0x[0-9a-f]+$/);
  });
});

/** Left-pad a bigint to 32 bytes. */
function concat32(v: bigint): Uint8Array {
  const hex = v.toString(16).padStart(64, '0');
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}
