import { HDKey } from '@scure/bip32';
import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha256';
import { base58 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1';
import { tronAddressFromXpub, isValidTronAddress } from '../../src/wallet/tron-address';

// A fixed, deterministic master seed — the HSM's role in a test.
const seed = new Uint8Array(64);
for (let i = 0; i < 64; i++) seed[i] = (i * 7 + 1) & 0xff;
const master = HDKey.fromMasterSeed(seed);
const account = master.derive("m/44'/195'/0'");
const xpub = account.publicExtendedKey;

/** Address straight from a public key — the reference the xpub path must match. */
function addressFromPubkey(pub: Uint8Array): string {
  const uncompressed = secp256k1.ProjectivePoint.fromHex(pub).toRawBytes(false);
  const hash = keccak_256(uncompressed.slice(1));
  const body = new Uint8Array(21);
  body[0] = 0x41;
  body.set(hash.slice(-20), 1);
  const checksum = sha256(sha256(body)).slice(0, 4);
  const full = new Uint8Array(25);
  full.set(body, 0);
  full.set(checksum, 21);
  return base58.encode(full);
}

describe('tron-address', () => {
  // The money-critical invariant: an address derived ONLINE from the public xpub
  // must equal the address the master key would derive. If it didn't, players
  // would send USDT to an address the treasury cannot spend from.
  it('xpub-derived address equals the master-key-derived address', () => {
    for (const i of [0, 1, 7, 255, 12345]) {
      const priv = master.derive(`m/44'/195'/0'/5/${i}`);
      expect(tronAddressFromXpub(xpub, i)).toBe(addressFromPubkey(priv.publicKey!));
    }
  });

  it('produces valid, T-prefixed, deterministic, per-index-unique addresses', () => {
    const a0 = tronAddressFromXpub(xpub, 0);
    expect(a0.startsWith('T')).toBe(true);
    expect(isValidTronAddress(a0)).toBe(true);
    expect(tronAddressFromXpub(xpub, 0)).toBe(a0); // deterministic
    expect(tronAddressFromXpub(xpub, 1)).not.toBe(a0); // unique per player
  });

  it('rejects malformed and bad-checksum withdrawal addresses', () => {
    expect(isValidTronAddress('not-an-address')).toBe(false);
    expect(isValidTronAddress('')).toBe(false);
    const good = tronAddressFromXpub(xpub, 0);
    const flipped = good.slice(0, -1) + (good.endsWith('a') ? 'b' : 'a');
    expect(isValidTronAddress(flipped)).toBe(false);
  });

  it('rejects a negative player index', () => {
    expect(() => tronAddressFromXpub(xpub, -1)).toThrow();
  });
});
