import { Decimal128 } from 'bson';
import { AccountModel } from '../../src/wallet/account.model';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { SecurityLogModel } from '../../src/security/security-log.model';
import { transfer } from '../../src/wallet/transfer';
import {
  AccountNotFoundError,
  IllegalFundFlowError,
  InsufficientBalanceError,
} from '../../src/wallet/errors';
import { Money } from '../../src/domain/money';
import { AccountType, LedgerType, LedgerDirection } from '../../src/domain/account-types';
import { setAlertHandler, resetAlertHandler } from '../../src/lib/alert';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/** Create an account, optionally pre-funded (test seeding only — prod funds via transfer DEPOSIT). */
async function makeAccount(
  accountType: AccountType,
  ownerId: string,
  available = '0',
): Promise<string> {
  const acc = await AccountModel.create({
    accountType,
    ownerId,
    availableBalance: Decimal128.fromString(available),
  });
  return acc._id;
}

async function availableOf(id: string): Promise<string> {
  const acc = await AccountModel.findById(id);
  return acc!.availableBalance.toString();
}

describe('transfer() — the single guarded money path', () => {
  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes(AccountModel, LedgerModel, SecurityLogModel);
  });
  afterAll(stopTestDb);
  afterEach(async () => {
    resetAlertHandler();
    await clearCollections();
  });

  it('moves funds and writes a matched double-entry pair', async () => {
    const player = await makeAccount(AccountType.PLAYER, 'p1', '100');
    const treasury = await makeAccount(AccountType.TREASURY, 'PLATFORM');

    const res = await transfer({
      fromAccountId: player,
      toAccountId: treasury,
      amount: Money.fromDecimalString('30'),
      type: LedgerType.RAKE,
      idempotencyKey: 'rake-1',
    });

    expect(res.applied).toBe(true);
    expect(parseFloat(await availableOf(player))).toBe(70);
    expect(parseFloat(await availableOf(treasury))).toBe(30);

    const entries = await LedgerModel.find({ idempotencyKey: 'rake-1' });
    expect(entries).toHaveLength(2);
    expect(entries.filter((e) => e.direction === LedgerDirection.DEBIT)).toHaveLength(1);
    expect(entries.filter((e) => e.direction === LedgerDirection.CREDIT)).toHaveLength(1);
  });

  it('is idempotent: a replayed key is a no-op', async () => {
    const player = await makeAccount(AccountType.PLAYER, 'p1', '100');
    const treasury = await makeAccount(AccountType.TREASURY, 'PLATFORM');
    const input = {
      fromAccountId: player,
      toAccountId: treasury,
      amount: Money.fromDecimalString('30'),
      type: LedgerType.RAKE,
      idempotencyKey: 'dup-rake',
    };

    const first = await transfer(input);
    const second = await transfer(input);

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(parseFloat(await availableOf(player))).toBe(70); // moved once, not twice
    expect(parseFloat(await availableOf(treasury))).toBe(30);
    expect(await LedgerModel.countDocuments({ idempotencyKey: 'dup-rake' })).toBe(2); // one pair
  });

  it('blocks overdraft and leaves balances + ledger untouched', async () => {
    const player = await makeAccount(AccountType.PLAYER, 'p1', '20');
    const treasury = await makeAccount(AccountType.TREASURY, 'PLATFORM');

    await expect(
      transfer({
        fromAccountId: player,
        toAccountId: treasury,
        amount: Money.fromDecimalString('50'),
        type: LedgerType.RAKE,
        idempotencyKey: 'over-1',
      }),
    ).rejects.toThrow(InsufficientBalanceError);

    expect(parseFloat(await availableOf(player))).toBe(20);
    expect(parseFloat(await availableOf(treasury))).toBe(0);
    expect(await LedgerModel.countDocuments({ idempotencyKey: 'over-1' })).toBe(0);
  });

  it('rejects a non-whitelisted flow: logs security event + fires ops alert (CB6)', async () => {
    const player = await makeAccount(AccountType.PLAYER, 'p1', '100');
    const reinsurance = await makeAccount(AccountType.REINSURANCE, 'PLATFORM');
    const alert = jest.fn();
    setAlertHandler(alert);

    await expect(
      transfer({
        fromAccountId: player,
        toAccountId: reinsurance,
        amount: Money.fromDecimalString('10'),
        type: LedgerType.BET,
        idempotencyKey: 'illegal-1',
      }),
    ).rejects.toThrow(IllegalFundFlowError);

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]![0]).toMatch(/Illegal fund flow: PLAYER -> REINSURANCE/);
    const logs = await SecurityLogModel.find({ event: 'ILLEGAL_FUND_FLOW' });
    expect(logs).toHaveLength(1);
    expect(parseFloat(await availableOf(player))).toBe(100); // nothing moved
  });

  it('rejects a non-positive amount', async () => {
    const player = await makeAccount(AccountType.PLAYER, 'p1', '100');
    const treasury = await makeAccount(AccountType.TREASURY, 'PLATFORM');
    await expect(
      transfer({
        fromAccountId: player,
        toAccountId: treasury,
        amount: Money.fromDecimalString('0'),
        type: LedgerType.RAKE,
        idempotencyKey: 'zero-1',
      }),
    ).rejects.toThrow(RangeError);
  });

  it('throws when an account does not exist', async () => {
    const treasury = await makeAccount(AccountType.TREASURY, 'PLATFORM');
    await expect(
      transfer({
        fromAccountId: 'no-such-account',
        toAccountId: treasury,
        amount: Money.fromDecimalString('10'),
        type: LedgerType.RAKE,
        idempotencyKey: 'missing-1',
      }),
    ).rejects.toThrow(AccountNotFoundError);
  });

  it('stays exact under concurrent transfers (no overdraft, no lost updates)', async () => {
    // Fund 25. Fire 40 concurrent transfers of 1 each → exactly 25 succeed, 15 hit overdraft.
    // All hit ONE account — maximal write contention. Correctness is the assertion here; this
    // worst-case single-doc contention is exactly what Phase-2 async aggregation removes in
    // production (spec Pitfall 1). Suppress the (expected) 50ms-breach alerts.
    setAlertHandler(() => {});
    const player = await makeAccount(AccountType.PLAYER, 'p1', '25');
    const treasury = await makeAccount(AccountType.TREASURY, 'PLATFORM');

    const attempts = Array.from({ length: 40 }, (_, i) =>
      transfer({
        fromAccountId: player,
        toAccountId: treasury,
        amount: Money.fromDecimalString('1'),
        type: LedgerType.RAKE,
        idempotencyKey: `conc-${i}`,
      }),
    );
    const settled = await Promise.allSettled(attempts);

    const applied = settled.filter((s) => s.status === 'fulfilled' && s.value.applied).length;
    const overdrawn = settled.filter(
      (s) => s.status === 'rejected' && s.reason instanceof InsufficientBalanceError,
    ).length;

    expect(applied).toBe(25);
    expect(overdrawn).toBe(15);
    expect(parseFloat(await availableOf(player))).toBe(0);
    expect(parseFloat(await availableOf(treasury))).toBe(25);
    // 25 successful transfers → 25 double-entry pairs → 50 ledger rows.
    expect(await LedgerModel.countDocuments({})).toBe(50);
  }, 120_000);
});
