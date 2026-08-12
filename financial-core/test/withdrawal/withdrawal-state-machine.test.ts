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

beforeAll(async () => {
  await startTestDb();
  await ensureIndexes(AccountModel, LedgerModel, WithdrawalModel);
});
afterAll(stopTestDb);
afterEach(clearCollections);

describe('withdrawal state machine', () => {

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

    await approveWithdrawal(id, 'ops-alice');
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
    await approveWithdrawal(id, 'ops-alice');
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
    await approveWithdrawal(id, 'ops-alice');
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

/**
 * [money] §3.6 — "APPROVED: risk control passed + human review (> $10K)".
 *
 * This rule was documented in SAMUEL.md as already enforced by the backend. It
 * was not: approveWithdrawal took an id and nothing else, so one anonymous call
 * released any sum. These tests are the enforcement, and the first two are the
 * ones that would have caught the gap.
 */
describe('[money] second approval above ₮10,000', () => {

  const large = async (player: string): Promise<string> =>
    requestWithdrawal({
      playerAccountId: player,
      amount: Money.fromDecimalString('25000'),
      address: 'TXaddrTest',
    });

  it('does not move a large withdrawal on one approval', async () => {
    const player = await makePlayer('50000');
    const id = await large(player);

    const first = await approveWithdrawal(id, 'ops-alice');

    expect(first.applied).toBe(false);
    expect(first.awaitingSecondApproval).toBe(true);
    // Still queued, and — the part that matters — no funds held.
    expect((await WithdrawalModel.findById(id))!.state).toBe(WithdrawalState.REQUESTED);
    expect(await balances(player)).toEqual({ available: 50000, clearing: 0 });
  });

  it('releases on a second, DIFFERENT approver', async () => {
    const player = await makePlayer('50000');
    const id = await large(player);

    await approveWithdrawal(id, 'ops-alice');
    const second = await approveWithdrawal(id, 'ops-bob');

    expect(second.applied).toBe(true);
    expect(second.approvals.sort()).toEqual(['ops-alice', 'ops-bob']);
    expect((await WithdrawalModel.findById(id))!.state).toBe(WithdrawalState.APPROVED);
    expect(await balances(player)).toEqual({ available: 25000, clearing: 25000});
  });

  it('does NOT let one person approve twice to reach two', async () => {
    // The rule is a second PERSON. A counter would pass this test; a set of
    // names is why it fails. This is the whole reason approvals is not a number.
    const player = await makePlayer('50000');
    const id = await large(player);

    await approveWithdrawal(id, 'ops-alice');
    const again = await approveWithdrawal(id, 'ops-alice');

    expect(again.applied).toBe(false);
    expect(again.awaitingSecondApproval).toBe(true);
    expect(again.approvals).toEqual(['ops-alice']);
    expect(await balances(player)).toEqual({ available: 50000, clearing: 0 });
  });

  it('still clears a small withdrawal on a single approval', async () => {
    const player = await makePlayer('50000');
    const id = await requestWithdrawal({
      playerAccountId: player,
      amount: Money.fromDecimalString('300'),
      address: 'TXaddrTest',
    });

    const only = await approveWithdrawal(id, 'ops-alice');

    expect(only.applied).toBe(true);
    expect(await balances(player)).toEqual({ available: 49700, clearing: 300 });
  });

  it('treats exactly ₮10,000 as small — the spec says "> $10K"', async () => {
    const player = await makePlayer('50000');
    const id = await requestWithdrawal({
      playerAccountId: player,
      amount: Money.fromDecimalString('10000'),
      address: 'TXaddrTest',
    });

    expect((await approveWithdrawal(id, 'ops-alice')).applied).toBe(true);
  });

  it('needs a second signature one cent over the line', async () => {
    const player = await makePlayer('50000');
    const id = await requestWithdrawal({
      playerAccountId: player,
      amount: Money.fromDecimalString('10000.01'),
      address: 'TXaddrTest',
    });

    expect((await approveWithdrawal(id, 'ops-alice')).applied).toBe(false);
  });

  it('records who approved, for the audit trail', async () => {
    const player = await makePlayer('50000');
    const id = await large(player);

    await approveWithdrawal(id, 'ops-alice');
    await approveWithdrawal(id, 'ops-bob');

    // "Who released this" must be answerable by name, not by a count.
    expect((await WithdrawalModel.findById(id))!.approvals.sort()).toEqual([
      'ops-alice',
      'ops-bob',
    ]);
  });

  it('survives two approvers racing the same withdrawal', async () => {
    // Read-then-write would let both observe one signature and both proceed,
    // releasing on two approvals that never saw each other. One atomic
    // findOneAndUpdate plus the state filter is what prevents it.
    const player = await makePlayer('50000');
    const id = await large(player);

    const results = await Promise.allSettled([
      approveWithdrawal(id, 'ops-alice'),
      approveWithdrawal(id, 'ops-bob'),
    ]);

    const applied = results.filter(
      (r) => r.status === 'fulfilled' && r.value.applied,
    ).length;
    expect(applied).toBeLessThanOrEqual(1);
    // Whatever the interleaving, the money moved at most once.
    const b = await balances(player);
    expect(b.clearing === 0 || b.clearing === 25000).toBe(true);
  });

  it('refuses an unnamed approver', async () => {
    const player = await makePlayer('50000');
    const id = await large(player);
    await expect(approveWithdrawal(id, '')).rejects.toThrow();
  });
});
