import {
  base58Encode,
  base58Decode,
  compactU16,
  keypairFromJson,
  buildMemoMessage,
  buildSignedTransaction,
  memoFor,
  MEMO_PROGRAM_ID,
  SolanaChainClient,
  addressOf,
} from '../../src/fairness/solana-client';
import { verify as edVerify, createPublicKey } from 'node:crypto';

/**
 * The Solana notary's building blocks, pinned against known vectors.
 *
 * Everything here is hand-rolled instead of imported, so each piece needs an
 * external truth to be checked against — a wrong base58 or a misplaced length
 * prefix produces a transaction the chain rejects (best case) or signs the
 * wrong bytes (worst case, and invisible until an explorer link 404s).
 */

describe('base58', () => {
  it('round-trips and matches known vectors', () => {
    // 'hello world' in Bitcoin base58 — a widely published vector.
    const hello = new TextEncoder().encode('hello world');
    expect(base58Encode(hello)).toBe('StV1DL6CwTryKyV');
    expect([...base58Decode('StV1DL6CwTryKyV')]).toEqual([...hello]);
  });

  it('preserves leading zero bytes as leading 1s', () => {
    expect(base58Encode(new Uint8Array([0, 0, 1]))).toBe('112');
    expect([...base58Decode('112')]).toEqual([0, 0, 1]);
  });

  it('decodes the Memo program id to exactly 32 bytes', () => {
    expect(base58Decode(MEMO_PROGRAM_ID)).toHaveLength(32);
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => base58Decode('0OIl')).toThrow(/not base58/);
  });
});

describe('compact-u16', () => {
  it('matches Solana’s short-vec encoding', () => {
    // Vectors from the Solana docs' shortvec examples.
    expect([...compactU16(0)]).toEqual([0x00]);
    expect([...compactU16(5)]).toEqual([0x05]);
    expect([...compactU16(0x7f)]).toEqual([0x7f]);
    expect([...compactU16(0x80)]).toEqual([0x80, 0x01]);
    expect([...compactU16(0xff)]).toEqual([0xff, 0x01]);
    expect([...compactU16(0x3fff)]).toEqual([0xff, 0x7f]);
  });
});

// A fixed test seed — 32 deliberate bytes, never a real key.
const TEST_SEED = Array.from({ length: 32 }, (_, i) => i + 1);

describe('keypairFromJson', () => {
  it('derives the public key from the seed', () => {
    const kp = keypairFromJson(JSON.stringify(TEST_SEED));
    expect(kp.publicKey).toHaveLength(32);
    expect(addressOf(kp)).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it('signs verifiably', () => {
    const kp = keypairFromJson(JSON.stringify(TEST_SEED));
    const message = new TextEncoder().encode('the bytes that were signed');
    const signature = kp.sign(message);

    // Verified with node's own ed25519 against the derived public key — the
    // signature must be over exactly these bytes, nothing hashed or prefixed.
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const pub = createPublicKey({
      key: Buffer.concat([spkiPrefix, Buffer.from(kp.publicKey)]),
      format: 'der',
      type: 'spki',
    });
    expect(edVerify(null, message, pub, signature)).toBe(true);
  });

  it('rejects a keypair file whose public half does not match its seed', () => {
    // A corrupted file must fail loudly, not sign with a key that is not the
    // address it claims — that transaction would vanish into someone else's
    // account history.
    const lying = [...TEST_SEED, ...Array.from({ length: 32 }, () => 7)];
    expect(() => keypairFromJson(JSON.stringify(lying))).toThrow(/does not match/);
  });
});

describe('the memo transaction', () => {
  const kp = keypairFromJson(JSON.stringify(TEST_SEED));
  // A syntactically valid base58 blockhash (32 bytes of 0x01).
  const blockhash = base58Encode(new Uint8Array(32).fill(1));

  it('lays the message out in Solana legacy order', () => {
    const msg = buildMemoMessage(kp.publicKey, blockhash, 'fairplay:test');

    // header: 1 signer, 0 readonly-signed, 1 readonly-unsigned
    expect([...msg.slice(0, 3)]).toEqual([1, 0, 1]);
    // compact-u16 account count = 2, then payer key, then the Memo program.
    expect(msg[3]).toBe(2);
    expect([...msg.slice(4, 36)]).toEqual([...kp.publicKey]);
    expect([...msg.slice(36, 68)]).toEqual([...base58Decode(MEMO_PROGRAM_ID)]);
    // then the recent blockhash…
    expect([...msg.slice(68, 100)]).toEqual([...base58Decode(blockhash)]);
    // …one instruction: program index 1, no accounts, then the memo bytes.
    const memo = new TextEncoder().encode('fairplay:test');
    expect(msg[100]).toBe(1); // instruction count
    expect(msg[101]).toBe(1); // program id index → Memo
    expect(msg[102]).toBe(0); // no instruction accounts
    expect(msg[103]).toBe(memo.length);
    expect([...msg.slice(104)]).toEqual([...memo]);
  });

  it('signs the exact message bytes', () => {
    const msg = buildMemoMessage(kp.publicKey, blockhash, 'fairplay:test');
    const tx = buildSignedTransaction(kp, msg);

    expect(tx[0]).toBe(1); // one signature
    const signature = tx.slice(1, 65);
    expect([...tx.slice(65)]).toEqual([...msg]);

    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const pub = createPublicKey({
      key: Buffer.concat([spkiPrefix, Buffer.from(kp.publicKey)]),
      format: 'der',
      type: 'spki',
    });
    expect(edVerify(null, msg, pub, signature)).toBe(true);
  });

  it('writes everything step 6b must match into the memo', () => {
    const memo = memoFor({
      merkleRoot: 'abc123',
      roundCount: 100,
      fromRoundId: 'r-1',
      toRoundId: 'r-100',
    });
    expect(memo).toBe('fairplay:v1:abc123:100:r-1:r-100');
  });
});

describe('SolanaChainClient (rpc mocked)', () => {
  const kp = keypairFromJson(JSON.stringify(TEST_SEED));

  it('sends a signed transaction and returns the signature', async () => {
    const calls: { method: string; params: unknown[] }[] = [];
    const fetchImpl = (async (_url: unknown, init: { body?: unknown } | undefined) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      calls.push(body);
      const result =
        body.method === 'getLatestBlockhash'
          ? { value: { blockhash: base58Encode(new Uint8Array(32).fill(2)) } }
          : 'tx-signature-base58';
      return { ok: true, json: async () => ({ result }) };
    }) as unknown as typeof fetch;

    const client = new SolanaChainClient('http://rpc.test', kp, fetchImpl);
    const tx = await client.commitMerkleRoot({
      merkleRoot: 'root',
      roundCount: 1,
      fromRoundId: 'a',
      toRoundId: 'a',
    });

    expect(tx).toBe('tx-signature-base58');
    const send = calls.find((c) => c.method === 'sendTransaction')!;
    // base64-encoded, and decodable back into a 1-signature transaction.
    const raw = Buffer.from(String(send.params[0]), 'base64');
    expect(raw[0]).toBe(1);
  });

  it('surfaces an RPC error instead of pretending', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({ error: { code: -32002, message: 'blockhash not found' } }),
    })) as unknown as typeof fetch;

    const client = new SolanaChainClient('http://rpc.test', kp, fetchImpl);
    await expect(
      client.commitMerkleRoot({ merkleRoot: 'r', roundCount: 1, fromRoundId: 'a', toRoundId: 'a' }),
    ).rejects.toThrow(/blockhash not found/);
    // The ResilientChainClient catches this and walks down the ladder — the
    // error is the signal that failover exists to hear.
  });
});
