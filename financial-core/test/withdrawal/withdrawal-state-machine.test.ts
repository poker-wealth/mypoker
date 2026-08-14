import { Decimal128 } from 'bson';
import { AccountModel } from '../../src/wallet/account.model';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { WithdrawalModel } from '../../src/withdrawal/withdrawal.model';
import {
  requestWithdrawal,
  approveWithdrawal,
  broadcastWithdrawal,
  confirmWithdrawal,
  rollbackWithdrawal,
} from '../../src/withdrawal/withdrawal-state-machine';
import { WithdrawalState } from '../../src/domain/withdrawal-types';
import {
  InsufficientBalanceError,
  InvalidWithdrawalTransitionError,
} from '../../src/wallet/errors';
import { Money } from '../../src/domain/money';
import { AccountType, LedgerType } from '../../src/domain/account-types';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

async function makePlayer(available: string): Promise<string> {
  const a = await AccountModel.create({
    accountType: AccountType.PLAYER,
    ownerId: 'p1',
    availableBalance: Decimal128.fromString(available),
  });
  return a._id;
}

async function makeTreasury(): Promise<string> {
  const a = await AccountModel.create({ accountType: AccountType.TREASURY, ownerId: 'PLATFORM' });
  return a._id;
}

async function balances(id: string): Promise<{ available: number; clearing: number }> {
  const a = await AccountModel.findById(id);
  return {
    available: parseFloat(a!.availableBalance.toString()),
    clearing: parseFloat(a!.clearingBalance.toString()),
  };
}

describe('withdrawal state machine', () => {
  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes(AccountModel, LedgerModel, WithdrawalModel);
  });
  afterAll(stopTestDb);
  afterEach(clearCollections);

  it('runs the full happy path: REQUESTED → APPROVED → BROADCASTING → CONFIRMED', async () => {
    const player = await makePlayer('1000');
    const treasury = await makeTreasury();

    const id = await requestWithdrawal({
      playerAccountId: player,
      amount: Money.fromDecimalString('300'),
      address: 'TXaddrTest',
    });
    // REQUESTED: nothing moved yet.
    expect((await balances(player))).toEqual({ available: 1000, clearing: 0 });

    await approveWithdrawal(id, 'ops-1');
    // APPROVED: held in clearing.
    expect(await balances(player)).toEqual({ available: 700, clearing: 300 });

    await broadcastWithdrawal(id, 'tx-hash-abc');
    expect((await WithdrawalModel.findById(id))!.txHash).toBe('tx-hash-abc');
    expect(await balances(player)).toEqual({ available: 700, clearing: 300 });

    await confirmWithdrawal(id);
    // CONFIRMED: clearing emptied, funds left the platform via the EXTERNAL boundary account.
    expect(await balances(player)).toEqual({ available: 700, clearing: 0 });
    const external = await AccountModel.findOne({ accountType: AccountType.EXTERNAL });
    expect(parseFloat(external!.availableBalance.toString())).toBe(300);
    expect((await WithdrawalModel.findById(id))!.state).toBe(WithdrawalState.CONFIRMED);
    // Treasury (rake/income) is untouched by a withdrawal.
    expect(parseFloat((await AccountModel.findById(treasury))!.availableBalance.toString())).toBe(0);

    // Exactly one double-entry WITHDRAW pair.
    expect(await LedgerModel.countDocuments({ type: LedgerType.WITHDRAW })).toBe(2);
  });

  it('held funds are not spendable — withdrawal locks the clearing amount', async () => {
    const player = await makePlayer('500');
    await makeTreasury();

    const id = await requestWithdrawal({
      playerAccountId: player,
      amount: Money.fromDecimalString('500'),
      address: 'TXaddr',
    });
    await approveWithdrawal(id, 'ops-1');
    expect(await balances(player)).toEqual({ available: 0, clearing: 500 });

    // A second withdrawal for the same funds cannot be approved — available is now 0.
    const id2 = await requestWithdrawal({
      playerAccountId: player,
      amount: Money.fromDecimalString('500'),
      address: 'TXaddr2',
    }).catch((e) => e);
    // request itself fails the early available check (available already 0).
    expect(id2).toBeInstanceOf(InsufficientBalanceError);
  });

  it('rolls back a held withdrawal and refunds clearing → available', async () => {
    const player = await makePlayer('1000');
    await makeTreasury();

    const id = await requestWithdrawal({
      playerAccountId: player,
      amount: Money.fromDecimalString('400'),
      address: 'TXaddr',
    });
    await approveWithdrawal(id, 'ops-1');
    expect(await balances(player)).toEqual({ available: 600, clearing: 400 });

    await rollbackWithdrawal(id, 'broadcast failed');
    // Hold released back to spendable.
    expect(await balances(player)).toEqual({ available: 1000, clearing: 0 });
    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.ROLLED_BACK);
    expect(w!.failureReason).toBe('broadcast failed');
    // No money left the platform → no WITHDRAW ledger entry.
    expect(await LedgerModel.countDocuments({ type: LedgerType.WITHDRAW })).toBe(0);
  });

  it('a withdrawal over $10k needs two DISTINCT approvers before funds are held', async () => {
    const player = await makePlayer('20000');
    await makeTreasury();
    const id = await requestWithdrawal({
      playerAccountId: player,
      amount: Money.fromDecimalString('15000'),
      address: 'TXbig',
    });

    // One approval is not enough: still REQUESTED, nothing held.
    expect(await approveWithdrawal(id, 'ops-1')).toEqual({
      state: WithdrawalState.REQUESTED,
      approvals: 1,
      required: 2,
    });
    expect(await balances(player)).toEqual({ available: 20000, clearing: 0 });

    // The SAME approver again is idempotent — still 1 of 2.
    expect((await approveWithdrawal(id, 'ops-1')).approvals).toBe(1);
    expect(await balances(player)).toEqual({ available: 20000, clearing: 0 });

    // A second, distinct approver crosses the threshold: funds held, APPROVED.
    expect(await approveWithdrawal(id, 'ops-2')).toEqual({
      state: WithdrawalState.APPROVED,
      approvals: 2,
      required: 2,
    });
    expect(await balances(player)).toEqual({ available: 5000, clearing: 15000 });
  });

  it('rolls back a REQUESTED withdrawal with no balance to release', async () => {
    const player = await makePlayer('1000');
    const id = await requestWithdrawal({
      playerAccountId: player,
      amount: Money.fromDecimalString('400'),
      address: 'TXaddr',
    });
    await rollbackWithdrawal(id, 'risk rejected');
    expect(await balances(player)).toEqual({ available: 1000, clearing: 0 });
    expect((await WithdrawalModel.findById(id))!.state).toBe(WithdrawalState.ROLLED_BACK);
  });

  it('rejects an illegal transition (cannot confirm a REQUESTED withdrawal)', async () => {
    const player = await makePlayer('1000');
    const id = await requestWithdrawal({
      playerAccountId: player,
      amount: Money.fromDecimalString('100'),
      address: 'TXaddr',
    });
    await expect(confirmWithdrawal(id)).rejects.toThrow(InvalidWithdrawalTransitionError);
  });

  it('rejects requesting more than the available balance', async () => {
    const player = await makePlayer('50');
    await expect(
      requestWithdrawal({
        playerAccountId: player,
        amount: Money.fromDecimalString('100'),
        address: 'TXaddr',
      }),
    ).rejects.toThrow(InsufficientBalanceError);
  });
});
