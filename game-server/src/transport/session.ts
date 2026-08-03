import { signMessage, verifyMessage } from './crypto';

/**
 * Session — per-connection security state after the ECDH handshake.
 *
 * Enforces two invariants on every inbound message (FairPlay M2):
 *   - monotonic sequence number  → replays / out-of-order are rejected
 *   - valid HMAC over (seq ‖ payload) → tamper / forgery is rejected
 *
 * Three failures disconnect the connection (and, upstream, ban the device fingerprint for 30 min).
 * Outbound server messages carry their own incrementing sequence + HMAC so the client can verify.
 */
export interface VerifyResult {
  ok: boolean;
  reason?: string;
  disconnect: boolean;
  payload?: string;
}

export class Session {
  private lastInboundSeq = 0;
  private outboundSeq = 0;
  private strikes = 0;
  /** Rooms this connection is currently joined to. */
  readonly rooms = new Set<string>();

  constructor(
    readonly playerId: string,
    private readonly key: Buffer,
    private readonly maxStrikes = 3,
  ) {}

  verifyInbound(seq: number, payload: string, mac: string): VerifyResult {
    if (!Number.isInteger(seq) || seq <= this.lastInboundSeq) {
      return this.strike('bad_sequence');
    }
    if (!verifyMessage(this.key, seq, payload, mac)) {
      return this.strike('bad_hmac');
    }
    this.lastInboundSeq = seq;
    return { ok: true, disconnect: false, payload };
  }

  /** Build a signed outbound envelope `{ seq, payload, mac }` for a server→client message. */
  signOutbound(payload: string): { seq: number; payload: string; mac: string } {
    const seq = ++this.outboundSeq;
    return { seq, payload, mac: signMessage(this.key, seq, payload) };
  }

  get strikeCount(): number {
    return this.strikes;
  }

  private strike(reason: string): VerifyResult {
    this.strikes += 1;
    return { ok: false, reason, disconnect: this.strikes >= this.maxStrikes };
  }
}
