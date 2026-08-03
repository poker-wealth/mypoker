import {
  generateEphemeralKeyPair,
  deriveSessionKey,
  signMessage,
  verifyMessage,
} from '../../src/transport/crypto';

describe('transport crypto (ECDH + HMAC)', () => {
  it('both parties derive the same session key from exchanged public keys', () => {
    const client = generateEphemeralKeyPair();
    const server = generateEphemeralKeyPair();
    const clientKey = deriveSessionKey(client.privateKey, server.publicKeyB64);
    const serverKey = deriveSessionKey(server.privateKey, client.publicKeyB64);
    expect(clientKey).toHaveLength(32);
    expect(clientKey.equals(serverKey)).toBe(true);
  });

  it('different connections derive different keys (ephemeral → forward secrecy)', () => {
    const a = generateEphemeralKeyPair();
    const b = generateEphemeralKeyPair();
    const c = generateEphemeralKeyPair();
    const k1 = deriveSessionKey(a.privateKey, b.publicKeyB64);
    const k2 = deriveSessionKey(a.privateKey, c.publicKeyB64);
    expect(k1.equals(k2)).toBe(false);
  });

  it('verifies a valid HMAC and rejects tamper / wrong key', () => {
    const key = Buffer.alloc(32, 7);
    const mac = signMessage(key, 5, '{"type":"join"}');
    expect(verifyMessage(key, 5, '{"type":"join"}', mac)).toBe(true);
    // tampered payload
    expect(verifyMessage(key, 5, '{"type":"leave"}', mac)).toBe(false);
    // tampered sequence
    expect(verifyMessage(key, 6, '{"type":"join"}', mac)).toBe(false);
    // wrong key
    expect(verifyMessage(Buffer.alloc(32, 8), 5, '{"type":"join"}', mac)).toBe(false);
  });
});
