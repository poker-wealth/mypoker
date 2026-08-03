import { createHash } from 'node:crypto';

/**
 * RFC 3161 timestamp notary — Layer 3 fallback (FairPlay v6.0 §4 / §6.2).
 *
 * When both Solana and Polygon are unavailable, the Merkle root is timestamped by an RFC 3161 Time
 * Stamp Authority (a legally recognized standard — banking/court grade). The game continues; the
 * batch is re-anchored on-chain once a chain recovers. The fake here is deterministic for dev/tests.
 */
export interface NotaryClient {
  /** Produce a timestamp token over the given data. Returns the token id. */
  timestamp(data: string): Promise<string>;
}

export class FakeNotary implements NotaryClient {
  readonly stamped: string[] = [];

  async timestamp(data: string): Promise<string> {
    this.stamped.push(data);
    return `rfc3161-${createHash('sha256').update(data).digest('hex').slice(0, 16)}`;
  }
}
