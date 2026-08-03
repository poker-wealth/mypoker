import { Decimal128 } from 'bson';
import { AccountModel } from '../../src/wallet/account.model';
import { lockForBuyIn, releaseToAvailable } from '../../src/wallet/seat-funds';
import { requestWithdrawal } from '../../src/withdrawal/withdrawal-state-machine';
import { WithdrawalModel } from '../../src/withdrawal/withdrawal.model';
import { AccountNotFoundError, InsufficientBalanceError } from '../../src/wallet/errors';
import { Money } from '../../src/domain/money';
import { AccountType } from '../../src/domain/account-types';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

async function makePlayer(available: string): Promise<string> {
  const a = await AccountModel.create({
    accountType: AccountType.PLAYER,
    ownerId: 'p1',
    availableBalance: Decimal128.fromString(available),
  });
  return a._id;
}

async function balances(id: string): Promise<{ available: number; locked: number }> {
  const a = await AccountModel.findById(id);
  return {
    available: parseFloat(a!.availableBalance.toString()),
    locked: parseFloat(a!.lockedBalance.toString()),
  };
}

describe('seat funds — buy-in / leave-table locking', () => {
  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes(AccountModel, WithdrawalModel);
  });
  afterAll(stopTestDb);
  afterEach(clearCollections);

  it('buy-in moves funds available → locked', async () => {
    const player = await makePlayer('1000');
    await lockForBuyIn(player, Money.fromDecimalString('600'));
    expect(await balances(player)).toEqual({ available: 400, locked: 600 });
  });

  it('cannot buy in more than available', async () => {
    const player = await makePlayer('500');
    await expect(lockForBuyIn(player, Money.fromDecimalString('600'))).rejects.toThrow(
      InsufficientBalanceError,
    );
    expect(await balances(player)).toEqual({ available: 500, locked: 0 });
  });

  it('locked funds are NOT withdrawable (withdrawal sees available only)', async () => {
    const player = await makePlayer('1000');
    await lockForBuyIn(player, Money.fromDecimalString('600')); // available 400 / locked 600
    await expect(
      requestWithdrawal({
        playerAccountId: player,
        amount: Money.fromDecimalString('500'), // > available (400), < available+locked
        address: 'TXaddr',
      }),
    ).rejects.toThrow(InsufficientBalanceError);
  });

  it('leave-table releases funds locked → available', async () => {
    const player = await makePlayer('1000');
    await lockForBuyIn(player, Money.fromDecimalString('600'));
    await releaseToAvailable(player, Money.fromDecimalString('600'));
    expect(await balances(player)).toEqual({ available: 1000, locked: 0 });
  });

  it('can release a partial stack (won/lost chips settled elsewhere)', async () => {
    const player = await makePlayer('1000');
    await lockForBuyIn(player, Money.fromDecimalString('600'));
    await releaseToAvailable(player, Money.fromDecimalString('250'));
    expect(await balances(player)).toEqual({ available: 650, locked: 350 });
  });

  it('cannot release more than is locked', async () => {
    const player = await makePlayer('1000');
    await lockForBuyIn(player, Money.fromDecimalString('200'));
    await expect(releaseToAvailable(player, Money.fromDecimalString('300'))).rejects.toThrow(
      InsufficientBalanceError,
    );
    expect(await balances(player)).toEqual({ available: 800, locked: 200 });
  });

  it('rejects unknown account and non-positive amounts', async () => {
    await expect(lockForBuyIn('nope', Money.fromDecimalString('10'))).rejects.toThrow(
      AccountNotFoundError,
    );
    const player = await makePlayer('100');
    await expect(lockForBuyIn(player, Money.fromDecimalString('0'))).rejects.toThrow(RangeError);
  });
});
