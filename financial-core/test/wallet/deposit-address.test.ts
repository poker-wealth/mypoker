import { HDKey } from '@scure/bip32';
import { startTestDb, stopTestDb, clearCollections } from '../db-helper';
import { getDepositAddress } from '../../src/wallet/deposit-address';
import { isValidTronAddress } from '../../src/wallet/tron-address';

const seed = new Uint8Array(64);
for (let i = 0; i < 64; i++) seed[i] = (i * 3 + 5) & 0xff;
const xpub = HDKey.fromMasterSeed(seed).derive("m/44'/195'/0'").publicExtendedKey;

beforeAll(startTestDb);
afterAll(stopTestDb);
afterEach(clearCollections);

describe('getDepositAddress', () => {
  it('returns null when no account xpub is configured', async () => {
    delete process.env.TRON_ACCOUNT_XPUB;
    expect(await getDepositAddress('p1')).toBeNull();
  });

  it('assigns each player a stable, valid, unique TRC-20 address', async () => {
    process.env.TRON_ACCOUNT_XPUB = xpub;

    const a1 = await getDepositAddress('p1');
    const a1Again = await getDepositAddress('p1');
    const a2 = await getDepositAddress('p2');

    expect(a1?.address).toBeTruthy();
    expect(isValidTronAddress(a1!.address)).toBe(true);
    expect(a1!.network).toBe('TRC20');
    // Same player always sees the same address — a returning deposit must land.
    expect(a1Again!.address).toBe(a1!.address);
    // Different players get different addresses.
    expect(a2!.address).not.toBe(a1!.address);
  });
});
