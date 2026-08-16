import { createHash } from 'node:crypto';
import type { NotaryClient } from './notary';

/**
 * A real RFC 3161 Time-Stamp notary — Layer 3 of the resilience ladder (v6.0 §4/§6.2). When both
 * Solana and Polygon are unavailable, the Merkle root is timestamped by a Time-Stamp Authority (TSA):
 * a legally recognized, court-grade proof that the root existed at a point in time. The batch is
 * re-anchored on a chain once one recovers.
 *
 * The TimeStampReq (DER) construction below is pure and unit-tested. The single network call — POST
 * the request to the TSA and read the token back — is the only part that cannot be tested without a
 * live TSA; it is isolated in `postToTsa` and returns the raw token, from which we derive a stable id.
 */

/** Minimal DER helpers — enough for a fixed-shape SHA-256 TimeStampReq. */
function derLen(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  let v = n;
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
  return [0x80 | bytes.length, ...bytes];
}
function derTLV(tag: number, content: number[]): number[] {
  return [tag, ...derLen(content.length), ...content];
}

// AlgorithmIdentifier for SHA-256: SEQUENCE { OID 2.16.840.1.101.3.4.2.1, NULL }.
const SHA256_ALG_ID = [
  0x30, 0x0d,
  0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, // OID 2.16.840.1.101.3.4.2.1
  0x05, 0x00, // NULL
];

/**
 * Build a DER-encoded RFC 3161 TimeStampReq over `data`:
 *   TimeStampReq ::= SEQUENCE { version INTEGER(1), messageImprint MessageImprint, certReq BOOLEAN }
 *   MessageImprint ::= SEQUENCE { hashAlgorithm AlgorithmIdentifier, hashedMessage OCTET STRING }
 * The imprint is SHA-256(data); certReq TRUE asks the TSA to return its certificate in the token.
 */
export function buildTimeStampReq(data: string): Uint8Array {
  const digest = [...createHash('sha256').update(data).digest()];
  const messageImprint = derTLV(0x30, [...SHA256_ALG_ID, ...derTLV(0x04, digest)]);
  const version = [0x02, 0x01, 0x01];
  const certReq = [0x01, 0x01, 0xff];
  return Uint8Array.from(derTLV(0x30, [...version, ...messageImprint, ...certReq]));
}

export class Rfc3161Notary implements NotaryClient {
  /**
   * @param tsaUrl  the TSA endpoint (e.g. http://timestamp.digicert.com)
   * @param post    the network boundary — overridable in tests; defaults to a real fetch POST.
   */
  constructor(
    private readonly tsaUrl: string,
    private readonly post: (url: string, req: Uint8Array) => Promise<Uint8Array> = postToTsa,
  ) {}

  async timestamp(data: string): Promise<string> {
    const token = await this.post(this.tsaUrl, buildTimeStampReq(data));
    // The token id is a stable digest of the TSA's response token — enough to reference/verify it.
    return `rfc3161-${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
  }
}

/** The one untestable line: send the DER request to the TSA and return the DER response token. */
async function postToTsa(url: string, req: Uint8Array): Promise<Uint8Array> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/timestamp-query' },
    body: req,
  });
  if (!res.ok) throw new Error(`TSA responded ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
