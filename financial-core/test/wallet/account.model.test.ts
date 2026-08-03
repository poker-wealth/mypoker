import { AccountModel } from '../../src/wallet/account.model';
import { AccountType, PLATFORM_SCOPE } from '../../src/domain/account-types';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

describe('accounts model', () => {
  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes(AccountModel);
  });
  afterAll(stopTestDb);
  afterEach(clearCollections);

  it('creates an account with all three balances defaulting to zero', async () => {
    const acc = await AccountModel.create({
      accountType: AccountType.PLAYER,
      ownerId: 'player-1',
    });
    expect(acc._id).toEqual(expect.any(String));
    expect(acc.scope).toBe(PLATFORM_SCOPE);
    expect(acc.availableBalance.toString()).toBe('0');
    expect(acc.lockedBalance.toString()).toBe('0');
    expect(acc.clearingBalance.toString()).toBe('0');
    expect(acc.version).toBe(0);
  });

  it('enforces one account per (type, owner, scope)', async () => {
    await AccountModel.create({ accountType: AccountType.TREASURY, ownerId: 'PLATFORM' });
    await expect(
      AccountModel.create({ accountType: AccountType.TREASURY, ownerId: 'PLATFORM' }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('allows the same player to hold separate platform and league wallets via scope', async () => {
    await AccountModel.create({
      accountType: AccountType.PLAYER,
      ownerId: 'player-1',
      scope: PLATFORM_SCOPE,
    });
    const league = await AccountModel.create({
      accountType: AccountType.PLAYER,
      ownerId: 'player-1',
      scope: 'league:42',
    });
    expect(league._id).toEqual(expect.any(String));
    expect(await AccountModel.countDocuments({ ownerId: 'player-1' })).toBe(2);
  });

  it('allows each table to hold its own four jackpot accounts', async () => {
    for (const t of [
      AccountType.JACKPOT_MINI,
      AccountType.JACKPOT_MINOR,
      AccountType.JACKPOT_MAJOR,
      AccountType.JACKPOT_GRAND,
    ]) {
      await AccountModel.create({ accountType: t, ownerId: 'table-7' });
    }
    expect(await AccountModel.countDocuments({ ownerId: 'table-7' })).toBe(4);
  });

  it('rejects an unknown account_type at the DB layer', async () => {
    await expect(
      AccountModel.create({ accountType: 'NOT_A_POOL' as AccountType, ownerId: 'x' }),
    ).rejects.toThrow();
  });
});
