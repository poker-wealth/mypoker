import { HDKey } from '@scure/bip32';
import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha256';
import { base58 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1';

/**
 * TRON (TRC-20) address derivation, from the account-level PUBLIC key only.
 *
 * §3.4 keeps the master key in an HSM, never online, never in code. Deriving a
 * per-player deposit address needs no private key: the account xpub is the
 * public key at `m/44'/195'/0'`, and the player leg `…/5/{index}` is a
 * non-hardened child, so an address can be produced online without any signing
 * power. This module therefore takes an xpub and never a secret.
 *
 * The address format is identical on TRON mainnet and the testnets (same 0x41
 * prefix, same base58check) — only the RPC network differs — so this is correct
 * for the testnet path we run today and unchanged when mainnet lands (W11).
 */

/** TRON address version byte (mainnet + testnets both use 0x41). */
const TRON_PREFIX = 0x41;

/** The player-branch index in the BIP-44 tree — see hd-derivation.playerDepositPath. */
const PLAYER_BRANCH = 5;

/** base58check: payload ‖ first-4-bytes(sha256(sha256(payload))). */
function base58check(payload: Uint8Array): string {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const out = new Uint8Array(payload.length + 4);
  out.set(payload, 0);
  out.set(checksum, payload.length);
  return base58.encode(out);
}

/**
 * The TRC-20 deposit address for `playerIndex`, derived from the account xpub.
 * `m/44'/195'/0'` (the xpub) → `/5/{playerIndex}` → secp256k1 pubkey →
 * keccak256(uncompressed pubkey, no prefix) → last 20 bytes → 0x41 ‖ … →
 * base58check. Deterministic: same xpub + index always yields the same address.
 */
export function tronAddressFromXpub(accountXpub: string, playerIndex: number): string {
  if (!Number.isInteger(playerIndex) || playerIndex < 0) {
    throw new RangeError('playerIndex must be a non-negative integer');
  }
  const account = HDKey.fromExtendedKey(accountXpub);
  const child = account.deriveChild(PLAYER_BRANCH).deriveChild(playerIndex);
  if (!child.publicKey) throw new Error('xpub produced no public key');

  // Uncompressed point (0x04 ‖ X ‖ Y); TRON hashes the 64-byte X‖Y, dropping 0x04.
  const uncompressed = secp256k1.ProjectivePoint.fromHex(child.publicKey).toRawBytes(false);
  const hash = keccak_256(uncompressed.slice(1));

  const address = new Uint8Array(21);
  address[0] = TRON_PREFIX;
  address.set(hash.slice(-20), 1);
  return base58check(address);
}

/**
 * Whether `address` is a well-formed TRON base58check address — used to reject a
 * bad withdrawal target before it ever reaches the chain. Validates the version
 * byte and the checksum; it cannot know whether the address exists on-chain.
 */
export function isValidTronAddress(address: string): boolean {
  let decoded: Uint8Array;
  try {
    decoded = base58.decode(address);
  } catch {
    return false;
  }
  if (decoded.length !== 25 || decoded[0] !== TRON_PREFIX) return false;
  const payload = decoded.slice(0, 21);
  const checksum = decoded.slice(21);
  const expected = sha256(sha256(payload)).slice(0, 4);
  return checksum.every((b, i) => b === expected[i]);
}
