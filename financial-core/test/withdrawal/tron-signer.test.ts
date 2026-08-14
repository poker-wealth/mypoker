import { addressToHex, encodeTransfer, usdtToUnits, addressFromPrivateKey } from '../../src/withdrawal/tron-signer';
import { isValidTronAddress } from '../../src/wallet/tron-address';

/**
 * The money-safety net for withdrawals. A wrong `to`-address or amount encoding sends real funds to
 * the wrong place or in the wrong quantity — so these deterministic parts are pinned. (The signing +
 * broadcast themselves need a live TronGrid + a funded hot wallet, tested on the first testnet send.)
 */
describe('tron-signer', () => {
  it('decodes a base58 TRON address to its 21-byte hex — checked against the real USDT contract', () => {
    // TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t is mainnet USDT-TRC20; its hex form is well-known.
    expect(addressToHex('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(
      '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
    );
  });

  it('converts USDT decimal strings to 6-decimal on-chain units exactly', () => {
    expect(usdtToUnits('20.00')).toBe(20_000_000n);
    expect(usdtToUnits('0.05')).toBe(50_000n);
    expect(usdtToUnits('1.5')).toBe(1_500_000n);
    expect(usdtToUnits('500')).toBe(500_000_000n);
    expect(usdtToUnits('0.000001')).toBe(1n); // one on-chain unit
  });

  it('ABI-encodes transfer(to, amount) as two right-aligned 32-byte words', () => {
    const enc = encodeTransfer('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 20_000_000n);
    expect(enc).toHaveLength(128);
    // to-word = the 20-byte body (no 0x41 version) right-aligned in 32 bytes
    expect(enc.slice(0, 64)).toBe('a614f803b6fd780986a42c78ec9c7f77e6ded13c'.padStart(64, '0'));
    // amount-word = 20_000_000 (0x1312d00) right-aligned
    expect(enc.slice(64)).toBe((20_000_000).toString(16).padStart(64, '0'));
  });

  it('derives a valid, deterministic TRON address from a private key', () => {
    const key = 'da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0';
    const a = addressFromPrivateKey(key);
    expect(isValidTronAddress(a.base58)).toBe(true);
    expect(a.hex).toMatch(/^41[0-9a-f]{40}$/);
    expect(addressFromPrivateKey(key).base58).toBe(a.base58); // deterministic
  });
});
