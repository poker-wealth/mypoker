import { webcrypto } from 'node:crypto';
import { generateEphemeralKeyPair, deriveSessionKey, signMessage } from '../../src/transport/crypto';

/**
 * The browser half of the handshake, checked against the server half.
 *
 * `frontend/src/api/tableSocket.ts` derives its session key with WebCrypto (X25519 → HKDF-SHA256)
 * while the server uses `node:crypto`. If those two ever disagree by a byte, every table silently
 * stops working in the browser and nowhere else — so this test performs the EXACT WebCrypto calls
 * the client makes and asserts both sides land on the same key and the same MAC.
 *
 * Keep it in step with `tableSocket.ts`.
 */

const HKDF_INFO = 'fairplay-ws-v1';

/** The client's half, using only WebCrypto — the same code path a browser takes. */
async function browserSide(serverPublicKeyB64: string): Promise<{ publicKeyB64: string; key: Buffer }> {
  const subtle = webcrypto.subtle;

  const pair = (await subtle.generateKey({ name: 'X25519' }, true, [
    'deriveBits',
  ])) as webcrypto.CryptoKeyPair;
  const serverKey = await subtle.importKey(
    'spki',
    Buffer.from(serverPublicKeyB64, 'base64'),
    { name: 'X25519' },
    false,
    [],
  );
  const shared = await subtle.deriveBits({ name: 'X25519', public: serverKey }, pair.privateKey, 256);
  const hkdfKey = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const sessionKey = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    hkdfKey,
    256,
  );

  return {
    publicKeyB64: Buffer.from(await subtle.exportKey('spki', pair.publicKey)).toString('base64'),
    key: Buffer.from(sessionKey),
  };
}

async function browserSign(key: Buffer, seq: number, payload: string): Promise<string> {
  const hmacKey = await webcrypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await webcrypto.subtle.sign(
    'HMAC',
    hmacKey,
    new TextEncoder().encode(`${seq}.${payload}`),
  );
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('browser ↔ server handshake compatibility', () => {
  it('derives an identical session key on both sides', async () => {
    const server = generateEphemeralKeyPair();
    const client = await browserSide(server.publicKeyB64);
    const serverKey = deriveSessionKey(server.privateKey, client.publicKeyB64);

    expect(client.key.length).toBe(32);
    expect(client.key.toString('hex')).toBe(serverKey.toString('hex'));
  });

  it('produces the same message MAC on both sides', async () => {
    const server = generateEphemeralKeyPair();
    const client = await browserSide(server.publicKeyB64);
    const payload = JSON.stringify({ type: 'action', roomId: 'texas', action: { kind: 'stand' } });

    expect(await browserSign(client.key, 7, payload)).toBe(signMessage(client.key, 7, payload));
  });
});
