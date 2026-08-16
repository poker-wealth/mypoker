import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { tronAddressFromPublicKey, type TronSigner } from './tron-signer';

/**
 * A TronSigner whose key lives in AWS KMS (or any HSM that speaks this port). The private key never
 * enters this process: we ask KMS for the public key once (to know our own address) and hand KMS each
 * 32-byte txID to sign. This is the mainnet key backend (§3.4).
 *
 * The AWS boundary is deliberately tiny — {@link KmsSignPort}, two calls — so ALL of the fiddly,
 * easy-to-get-wrong signing logic below (SPKI parsing, DER→r/s, low-S normalisation, recovery-id
 * search) is pure and unit-tested against a fake port. Only the two-line network round-trip in
 * aws-kms-port.ts is unavoidably untestable without a live CMK.
 */
export interface KmsSignPort {
  /** The CMK's public key as DER-encoded SubjectPublicKeyInfo (AWS KMS `GetPublicKey`). */
  getPublicKeyDer(): Promise<Uint8Array>;
  /** A DER-encoded ECDSA signature over the given 32-byte digest (AWS KMS `Sign`, MessageType DIGEST). */
  signDigest(digest: Uint8Array): Promise<Uint8Array>;
}

/**
 * Extract the 65-byte uncompressed point (`0x04‖X‖Y`) from a secp256k1 SPKI DER public key. The point
 * is the BIT STRING payload at the tail of the SPKI, after a fixed algorithm-identifier prefix — so
 * for the one curve we use, taking the last 65 bytes is exact and needs no full ASN.1 parser.
 */
export function publicKeyFromSpkiDer(der: Uint8Array): Uint8Array {
  const point = der.slice(der.length - 65);
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error('KMS public key is not a 65-byte uncompressed secp256k1 point (unexpected SPKI)');
  }
  return point;
}

export class KmsTronSigner implements TronSigner {
  private cached: { hex: string; base58: string } | undefined;
  constructor(private readonly port: KmsSignPort) {}

  async address(): Promise<{ hex: string; base58: string }> {
    if (!this.cached) {
      this.cached = tronAddressFromPublicKey(publicKeyFromSpkiDer(await this.port.getPublicKeyDer()));
    }
    return this.cached;
  }

  async signTxId(txIdHex: string): Promise<string> {
    const der = await this.port.signDigest(hexToBytes(txIdHex));
    let sig = secp256k1.Signature.fromDER(der);
    // secp256k1 consensus rejects a high-S signature (malleability); KMS may return either half.
    if (sig.hasHighS()) sig = sig.normalizeS();

    // KMS does not report the recovery id, so recover it: exactly one of {0,1} reconstructs a public
    // key that hashes to our own address. TRON checks that recovered key against owner_address, so
    // the recovery byte must be the right one — we do not guess, we verify.
    const expectedBody = (await this.address()).hex.slice(2); // 20-byte address body (drop 0x41)
    for (const rec of [0, 1] as const) {
      const pub = sig.addRecoveryBit(rec).recoverPublicKey(txIdHex).toRawBytes(false);
      if (tronAddressFromPublicKey(pub).hex.slice(2) === expectedBody) {
        return bytesToHex(sig.toCompactRawBytes()) + (rec === 1 ? '01' : '00');
      }
    }
    throw new Error('KMS signature did not recover to the wallet address — wrong CMK or corrupt signature');
  }
}
