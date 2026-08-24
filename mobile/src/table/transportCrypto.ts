import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64 } from '@scure/base';

/**
 * The transport crypto, for React Native.
 *
 * The web client does all of this with WebCrypto (`crypto.subtle`). React Native has no WebCrypto
 * at all — no X25519, no HKDF, no HMAC — so the same handshake is rebuilt here on @noble, which is
 * pure JS and runs on Hermes. Every value it produces has to match `game-server/src/transport/
 * crypto.ts` byte for byte, or the first authenticated frame is rejected and the table never opens.
 *
 * The subtle part is the key ENCODING. The server exports its ephemeral public key as DER/SPKI and
 * expects ours in the same form (`createPublicKey({ format: 'der', type: 'spki' })`), while noble
 * speaks raw 32-byte keys. For X25519 that wrapper is a fixed 12-byte prefix and nothing else, so
 * the conversion is exact rather than a guess — see SPKI_PREFIX below.
 */

/** HKDF info string. Must match the server's `Buffer.from('fairplay-ws-v1')`. */
const HKDF_INFO = 'fairplay-ws-v1';

/**
 * The DER/SPKI header for an X25519 public key, which is the same twelve bytes every time:
 *
 *   30 2a          SEQUENCE, 42 bytes
 *     30 05        SEQUENCE, 5 bytes   (AlgorithmIdentifier)
 *       06 03 2b 65 6e   OID 1.3.101.110 = id-X25519
 *     03 21 00     BIT STRING, 33 bytes, 0 unused bits
 *       <32-byte key>
 *
 * Fixed-length and parameterless, so wrapping and unwrapping is prefix arithmetic. Anything longer
 * or shorter than 44 bytes is not an X25519 SPKI key and is rejected rather than truncated.
 */
const SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00,
]);
const RAW_KEY_BYTES = 32;
const SPKI_BYTES = SPKI_PREFIX.length + RAW_KEY_BYTES;

export interface EphemeralKeyPair {
  privateKey: Uint8Array;
  /** Base64 DER/SPKI — the form the server expects on the wire. */
  publicKeyB64: string;
}

/** Wrap a raw 32-byte X25519 public key in its SPKI envelope. */
function toSpki(raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(SPKI_BYTES);
  out.set(SPKI_PREFIX, 0);
  out.set(raw, SPKI_PREFIX.length);
  return out;
}

/**
 * Pull the raw 32-byte key out of an SPKI envelope.
 *
 * Checks the header rather than blindly slicing the tail: a key that is not X25519, or one that has
 * been truncated, should fail here with something readable instead of becoming a wrong shared
 * secret and a MAC mismatch three frames later.
 */
function fromSpki(spki: Uint8Array): Uint8Array {
  if (spki.length !== SPKI_BYTES) {
    throw new Error(`expected a ${SPKI_BYTES}-byte X25519 SPKI key, got ${spki.length}`);
  }
  for (let i = 0; i < SPKI_PREFIX.length; i++) {
    if (spki[i] !== SPKI_PREFIX[i]) throw new Error('not an X25519 SPKI public key');
  }
  return spki.slice(SPKI_PREFIX.length);
}

/** A fresh ephemeral pair for one connection. */
export function generateEphemeralKeyPair(): EphemeralKeyPair {
  // @noble/curves v2 names these secretKey/publicKey; the pair is generated together.
  const { secretKey, publicKey } = x25519.keygen();
  return { privateKey: secretKey, publicKeyB64: base64.encode(toSpki(publicKey)) };
}

/**
 * The shared 32-byte session key, from our private key and the server's public key.
 *
 * ECDH, then HKDF-SHA256 with an EMPTY salt and info `fairplay-ws-v1` — the same three choices the
 * server makes in `deriveSessionKey`. Change any one of them and both sides derive silently
 * different keys.
 */
export function deriveSessionKey(privateKey: Uint8Array, peerPublicKeyB64: string): Uint8Array {
  const peerRaw = fromSpki(base64.decode(peerPublicKeyB64));
  const shared = x25519.getSharedSecret(privateKey, peerRaw);
  return hkdf(sha256, shared, new Uint8Array(0), new TextEncoder().encode(HKDF_INFO), 32);
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** HMAC-SHA256 over `${seq}.${payload}` → hex, matching the server's `signMessage`. */
export function signMessage(key: Uint8Array, seq: number, payload: string): string {
  return toHex(hmac(sha256, key, new TextEncoder().encode(`${seq}.${payload}`)));
}

/**
 * Verify an inbound MAC.
 *
 * Not timing-safe, and it does not need to be: this runs on the player's own device against a value
 * the server just sent them. The server side, where a timing leak would matter, compares with
 * `timingSafeEqual`.
 */
export function verifyMessage(
  key: Uint8Array,
  seq: number,
  payload: string,
  mac: string,
): boolean {
  return signMessage(key, seq, payload) === mac;
}
