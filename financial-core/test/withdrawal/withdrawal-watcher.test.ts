import { Decimal128 } from 'bson';
import { AccountModel } from '../../src/wallet/account.model';
import { WithdrawalModel } from '../../src/withdrawal/withdrawal.model';
import { requestWithdrawal, approveWithdrawal } from '../../src/withdrawal/withdrawal-state-machine';
import { checkWithdrawalsOnce, type WithdrawalTxSource } from '../../src/withdrawal/withdrawal-watcher';
import { WithdrawalState } from '../../src/domain/withdrawal-types';
import { Money } from '../../src/domain/money';
import { AccountType } from '../../src/domain/account-types';
import { setAlertHandler, resetAlertHandler, type AlertContext } from '../../src/lib/alert';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * BUG-09 follow-up (D4b): the watcher's second scan reconciles APPROVED withdrawals carrying an
 * unresolved `pendingTxId` — a broadcast whose HTTP response was lost, so the caller never learned
 * whether it landed. These pin its three outcomes: mined (either way) resolves it, not-yet-expired
 * leaves it alone, and expired-and-still-unmined alerts and releases it back for a human to re-send.
 */

const PENDING_TX = 'e'.repeat(64);

async function makePlayer(available: string): Promise<string> {
  const a = await AccountModel.create({
    accountType: AccountType.PLAYER,
    ownerId: 'p1',
    availableBalance: Decimal128.fromString(available),
  });
  return a._id;
}

async function approvedWithdrawalWithPendingTx(pendingTxExpiration?: Date): Promise<string> {
  const player = await makePlayer('1000');
  const id = await requestWithdrawal({
    playerAccountId: player,
    amount: Money.fromDecimalString('300'),
    address: 'TXaddrTest',
  });
  await approveWithdrawal(id, 'ops-1');
  await WithdrawalModel.updateOne(
    { _id: id },
    { $set: { pendingTxId: PENDING_TX, ...(pendingTxExpiration ? { pendingTxExpiration } : {}) } },
  );
  return id;
}

function sourceReturning(status: 'SUCCESS' | 'FAILED' | 'PENDING'): WithdrawalTxSource {
  return async () => ({ status, confirmations: 0 });
}

describe('withdrawal watcher — unresolved pendingTxId reconciliation (BUG-09 D4b)', () => {
  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes(AccountModel, WithdrawalModel);
  });
  afterAll(stopTestDb);
  afterEach(async () => {
    await clearCollections();
    resetAlertHandler();
  });

  it('a pendingTxId that mined SUCCESS resolves to BROADCASTING with the real txHash', async () => {
    const id = await approvedWithdrawalWithPendingTx(new Date(Date.now() + 60_000));
    await checkWithdrawalsOnce(sourceReturning('SUCCESS'));

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.BROADCASTING);
    expect(w!.txHash).toBe(PENDING_TX);
    expect(w!.pendingTxId).toBeUndefined();
  });

  it('a pendingTxId that mined FAILED also resolves to BROADCASTING — the ordinary scan rolls it back next pass', async () => {
    const id = await approvedWithdrawalWithPendingTx(new Date(Date.now() + 60_000));
    await checkWithdrawalsOnce(sourceReturning('FAILED'));

    // First pass: recorded as BROADCASTING (mined either way — no longer ambiguous).
    let w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.BROADCASTING);
    expect(w!.txHash).toBe(PENDING_TX);

    // Second pass: the ordinary BROADCASTING scan sees the same on-chain failure and rolls it back,
    // exactly as it would for a send that reported back normally.
    await checkWithdrawalsOnce(sourceReturning('FAILED'));
    w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.ROLLED_BACK);
  });

  it('leaves a still-pending, not-yet-expired broadcast alone', async () => {
    const id = await approvedWithdrawalWithPendingTx(new Date(Date.now() + 60_000));
    const alerts: unknown[] = [];
    setAlertHandler((message) => void alerts.push(message));

    await checkWithdrawalsOnce(sourceReturning('PENDING'));

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.APPROVED);
    expect(w!.pendingTxId).toBe(PENDING_TX);
    expect(alerts).toHaveLength(0);
  });

  it('alerts but does NOT release a legacy pendingTxId with no recorded expiration', async () => {
    const id = await approvedWithdrawalWithPendingTx(); // no pendingTxExpiration
    const alerts: { message: string; context: AlertContext | undefined }[] = [];
    setAlertHandler((message, context) => {
      alerts.push({ message, context });
    });

    await checkWithdrawalsOnce(sourceReturning('PENDING'));

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.APPROVED);
    expect(w!.pendingTxId).toBe(PENDING_TX); // NOT released — no expiry to reason from
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message).toMatch(/no recorded expiration/i);
  });

  it('alerts and releases an unmined broadcast once its expiration is well past', async () => {
    const id = await approvedWithdrawalWithPendingTx(new Date(Date.now() - 10 * 60_000)); // 10 min ago
    const alerts: { message: string; context: AlertContext | undefined }[] = [];
    setAlertHandler((message, context) => {
      alerts.push({ message, context });
    });

    await checkWithdrawalsOnce(sourceReturning('PENDING'));

    const w = await WithdrawalModel.findById(id);
    // Released back to plain APPROVED, not rolled back — re-sending is still a human decision, and the
    // funds were never anything but held in clearing the whole time (no refund either way).
    expect(w!.state).toBe(WithdrawalState.APPROVED);
    expect(w!.pendingTxId).toBeUndefined();
    expect(w!.pendingTxExpiration).toBeUndefined();

    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message).toMatch(/expired unmined/i);
    expect(alerts[0]!.context).toMatchObject({ withdrawalId: id, txId: PENDING_TX });
  });

  it('does not yet release an expired-but-within-grace unmined broadcast', async () => {
    // Expired 1 minute ago — inside the 3-minute grace window.
    const id = await approvedWithdrawalWithPendingTx(new Date(Date.now() - 60_000));
    const alerts: unknown[] = [];
    setAlertHandler((message) => void alerts.push(message));

    await checkWithdrawalsOnce(sourceReturning('PENDING'));

    const w = await WithdrawalModel.findById(id);
    expect(w!.pendingTxId).toBe(PENDING_TX); // still held — not yet past the grace window
    expect(alerts).toHaveLength(0);
  });
});
