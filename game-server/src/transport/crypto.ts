import {
  generateKeyPairSync,
  diffieHellman,
  createPublicKey,
  createHmac,
  timingSafeEqual,
  hkdfSync,
  type KeyObject,
} from 'node:crypto';

/**
 * Transport crypto (FairPlay M2 WebSocket security).
 *
 * Per connection, client and server each generate an EPHEMERAL X25519 key pair, exchange public
 * keys, and derive a shared session key via ECDH + HKDF. Because the keys are ephemeral, a future
 * key compromise can't decrypt past sessions (forward secrecy). Every message is then authenticated
 * with HMAC-SHA256 over (sequence ‖ payload), compared timing-safe.
 */

export interface EphemeralKeyPair {
  privateKey: KeyObject;
  /** Base64 (DER/SPKI) — what gets sent to the peer. */
  publicKeyB64: string;
}

export function generateEphemeralKeyPair(): EphemeralKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const publicKeyB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { privateKey, publicKeyB64 };
}

/** Derive the shared 32-byte session key from our private key and the peer's public key. */
export function deriveSessionKey(privateKey: KeyObject, peerPublicKeyB64: string): Buffer {
  const peerPublicKey = createPublicKey({
    key: Buffer.from(peerPublicKeyB64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  const shared = diffieHellman({ privateKey, publicKey: peerPublicKey });
  // HKDF to a uniformly-random 32-byte key (fixed salt/info — both sides agree).
  const derived = hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from('fairplay-ws-v1'), 32);
  return Buffer.from(derived);
}

/** HMAC-SHA256 over `${seq}.${payload}` → hex. */
export function signMessage(key: Buffer, seq: number, payload: string): string {
  return createHmac('sha256', key).update(`${seq}.${payload}`).digest('hex');
}

/** Timing-safe verification of a message HMAC. */
export function verifyMessage(key: Buffer, seq: number, payload: string, mac: string): boolean {
  const expected = signMessage(key, seq, payload);
  const a = Buffer.from(mac, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
