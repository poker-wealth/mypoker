import { secp256k1 } from '@noble/curves/secp256k1';
import { hexToBytes } from '@noble/hashes/utils';
import { addressFromPrivateKey, LocalPrivateKeySigner } from '../../src/withdrawal/tron-signer';
import { KmsTronSigner, publicKeyFromSpkiDer, type KmsSignPort } from '../../src/withdrawal/kms-signer';

/**
 * The KMS signer's logic — SPKI parse, DER→r/s, low-S normalisation, recovery-id search — verified
 * end to end against a fake KMS port backed by a local key. The only thing this cannot cover is the
 * live AWS round-trip in aws-kms-port.ts (no CMK in CI); that transport is intentionally two lines.
 */

const KEY = 'da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0';
const PRIV = hexToBytes(KEY);
// A stand-in txID — any 32-byte digest (the real one is sha256(raw_data) from TronGrid).
const TXID = 'b'.repeat(64);

/** secp256k1 SPKI prefix (id-ecPublicKey + secp256k1) that precedes the 65-byte point in KMS output. */
const SPKI_PREFIX = hexToBytes('3056301006072a8648ce3d020106052b8104000a034200');

/** A fake KMS: derives the public key and signs locally, mimicking what a real CMK would return. */
class FakeKmsSignPort implements KmsSignPort {
  constructor(private readonly mode: 'low' | 'high' = 'low') {}

  async getPublicKeyDer(): Promise<Uint8Array> {
    const point = secp256k1.getPublicKey(PRIV, false); // 65-byte 0x04‖X‖Y
    const der = new Uint8Array(SPKI_PREFIX.length + point.length);
    der.set(SPKI_PREFIX, 0);
    der.set(point, SPKI_PREFIX.length);
    return der;
  }

  async signDigest(digest: Uint8Array): Promise<Uint8Array> {
    const sig = secp256k1.sign(digest, PRIV); // deterministic (RFC-6979), low-S
    if (this.mode === 'high') {
      // The high-S representative KMS might emit: s' = n − s. DER carries no recovery bit anyway.
      const highS = new secp256k1.Signature(sig.r, secp256k1.CURVE.n - sig.s);
      return highS.toDERRawBytes();
    }
    return sig.toDERRawBytes();
  }
}

describe('KmsTronSigner', () => {
  it('derives its address from the KMS public key, identically to the raw key', async () => {
    const signer = new KmsTronSigner(new FakeKmsSignPort());
    expect(await signer.address()).toEqual(addressFromPrivateKey(KEY));
  });

  it('rejects an SPKI that does not end in a 65-byte uncompressed point', () => {
    expect(() => publicKeyFromSpkiDer(hexToBytes('deadbeef'))).toThrow(/uncompressed/);
  });

  it('signs into 65 bytes that recover to the wallet address, and matches the local signer exactly', async () => {
    const kms = new KmsTronSigner(new FakeKmsSignPort());
    const local = new LocalPrivateKeySigner(KEY);
    const sig = await kms.signTxId(TXID);
    expect(sig).toHaveLength(130);
    expect(['00', '01']).toContain(sig.slice(128));
    // Both are deterministic + low-S for the same key/digest, so they must be byte-identical.
    expect(sig).toBe(await local.signTxId(TXID));
  });

  it('normalises a high-S KMS signature to low-S and still recovers correctly', async () => {
    const kms = new KmsTronSigner(new FakeKmsSignPort('high'));
    const sig = await kms.signTxId(TXID);
    expect(sig).toHaveLength(130);
    // After normalisation the result is the canonical low-S signature — identical to the low-S path.
    expect(sig).toBe(await new KmsTronSigner(new FakeKmsSignPort('low')).signTxId(TXID));
    // And it is genuinely low-S.
    expect(secp256k1.Signature.fromCompact(hexToBytes(sig.slice(0, 128))).hasHighS()).toBe(false);
  });
});
