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
 *
 * BUG-09 second follow-up (D11): "not-yet-expired" / "expired" is judged against the CHAIN's own
 * reported time (`chainTimeMs`), never `Date.now()` — a wrong local clock must not be able to release
 * a hold early, or keep one stuck, based on a time the chain itself never reported. `sourceReturning`
 * below takes `chainTimeMs` explicitly so each test controls it independently of the real wall clock.
 *
 * BUG-09 second follow-up (D12): one row's failure while resolving a mined pendingTxId — most
 * plausibly a chainChecked reject winning a race against the SAME tx actually mining — must not stop
 * the rest of the pass, and must alert loudly (a double-pay) if that's what actually happened.
 */

const PENDING_TX = 'e'.repeat(64);

async function approvedWithdrawalWithPendingTx(
  pendingTxExpiration?: Date,
  pendingTxId: string = PENDING_TX,
  ownerId = 'p1',
): Promise<string> {
  const a = await AccountModel.create({
    accountType: AccountType.PLAYER,
    ownerId,
    availableBalance: Decimal128.fromString('1000'),
  });
  const id = await requestWithdrawal({
    playerAccountId: a._id,
    amount: Money.fromDecimalString('300'),
    address: 'TXaddrTest',
  });
  await approveWithdrawal(id, 'ops-1');
  await WithdrawalModel.updateOne(
    { _id: id },
    { $set: { pendingTxId, ...(pendingTxExpiration ? { pendingTxExpiration } : {}) } },
  );
  return id;
}

function sourceReturning(
  status: 'SUCCESS' | 'FAILED' | 'PENDING',
  chainTimeMs?: number,
): WithdrawalTxSource {
  return async () => ({ status, confirmations: 0, ...(chainTimeMs !== undefined ? { chainTimeMs } : {}) });
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
    const expiration = new Date(Date.now() + 60_000);
    const id = await approvedWithdrawalWithPendingTx(expiration);
    const alerts: unknown[] = [];
    setAlertHandler((message) => void alerts.push(message));

    await checkWithdrawalsOnce(sourceReturning('PENDING', expiration.getTime() - 1_000));

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

  it('alerts and releases an unmined broadcast once its expiration is well past (by chain time)', async () => {
    const expiration = new Date(Date.now() - 10 * 60_000); // 10 min ago
    const id = await approvedWithdrawalWithPendingTx(expiration);
    const alerts: { message: string; context: AlertContext | undefined }[] = [];
    setAlertHandler((message, context) => {
      alerts.push({ message, context });
    });

    // D11: chain time, not Date.now(), is what actually drives this — 4 minutes past expiration is
    // past the 3-minute grace window.
    await checkWithdrawalsOnce(sourceReturning('PENDING', expiration.getTime() + 4 * 60_000));

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
    // Expired (by chain time) 1 minute ago — inside the 3-minute grace window.
    const expiration = new Date(Date.now() - 60_000);
    const id = await approvedWithdrawalWithPendingTx(expiration);
    const alerts: unknown[] = [];
    setAlertHandler((message) => void alerts.push(message));

    await checkWithdrawalsOnce(sourceReturning('PENDING', expiration.getTime() + 60_000));

    const w = await WithdrawalModel.findById(id);
    expect(w!.pendingTxId).toBe(PENDING_TX); // still held — not yet past the grace window
    expect(alerts).toHaveLength(0);
  });

  // D11: the whole point — a local clock that is wrong must not be able to release a hold early. Here
  // the expiration is, by WALL CLOCK, an hour in the past (long past any grace period if judged
  // locally), but the chain itself reports a time just BEFORE that expiration — so nothing releases.
  it('D11: judges expiry against chain time, not the local clock', async () => {
    const expiration = new Date(Date.now() - 60 * 60_000);
    const id = await approvedWithdrawalWithPendingTx(expiration);
    const alerts: unknown[] = [];
    setAlertHandler((message) => void alerts.push(message));

    await checkWithdrawalsOnce(sourceReturning('PENDING', expiration.getTime() - 1_000));

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.APPROVED);
    expect(w!.pendingTxId).toBe(PENDING_TX); // NOT released — chain time says it hasn't expired yet
    expect(alerts).toHaveLength(0);
  });

  it('D11: alerts but does not release when the source cannot report chain time', async () => {
    const expiration = new Date(Date.now() - 10 * 60_000);
    const id = await approvedWithdrawalWithPendingTx(expiration);
    const alerts: { message: string; context: AlertContext | undefined }[] = [];
    setAlertHandler((message, context) => {
      alerts.push({ message, context });
    });

    await checkWithdrawalsOnce(sourceReturning('PENDING')); // no chainTimeMs

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.APPROVED);
    expect(w!.pendingTxId).toBe(PENDING_TX); // not released — never guess off the local clock
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message).toMatch(/chain time is unavailable/i);
    expect(alerts[0]!.context).toMatchObject({ withdrawalId: id, txId: PENDING_TX });
  });

  // D12: an admin's chainChecked reject can win a race against the SAME pendingTxId actually mining —
  // reconcile reads the row as APPROVED/pendingTxId, calls the chain, and only then tries to record it
  // as resolved; if a reject landed in between, that write now fails against a row that has moved to
  // ROLLED_BACK. That combination — refunded AND mined — is a double-pay and must alert loudly, and
  // must not stop the rest of the pass from being reconciled.
  it('D12: a row rolled back mid-pass alerts a double-pay and the rest of the pass still runs', async () => {
    const raceTxId = 'f'.repeat(64);
    const normalTxId = 'a'.repeat(64);
    const raced = await approvedWithdrawalWithPendingTx(new Date(Date.now() + 60_000), raceTxId, 'p1');
    const normal = await approvedWithdrawalWithPendingTx(new Date(Date.now() + 60_000), normalTxId, 'p2');

    const alerts: { message: string; context: AlertContext | undefined }[] = [];
    setAlertHandler((message, context) => {
      alerts.push({ message, context });
    });

    // Simulate the race: by the time the chain is checked for `raced`'s tx, an admin's chainChecked
    // reject has already rolled it back — mirroring what rollbackWithdrawal actually does, without
    // needing real concurrency.
    const racyMinedSource: WithdrawalTxSource = async (txHash) => {
      if (txHash === raceTxId) {
        await WithdrawalModel.updateOne({ _id: raced }, { $set: { state: WithdrawalState.ROLLED_BACK } });
      }
      return { status: 'SUCCESS', confirmations: 0 };
    };

    await checkWithdrawalsOnce(racyMinedSource);

    const doubled = alerts.find((a) => /DOUBLE PAY/.test(a.message));
    expect(doubled).toBeDefined();
    expect(doubled!.context).toMatchObject({ withdrawalId: raced, txId: raceTxId });

    // The raced row is untouched beyond the simulated race itself (still ROLLED_BACK, not silently
    // reset), and the OTHER row in the same pass was still resolved normally.
    expect((await WithdrawalModel.findById(raced))!.state).toBe(WithdrawalState.ROLLED_BACK);
    const w2 = await WithdrawalModel.findById(normal);
    expect(w2!.state).toBe(WithdrawalState.BROADCASTING);
    expect(w2!.txHash).toBe(normalTxId);
  });

  // D14: the SAME race as D12 above, but the tx that mined while the refund landed reverted on-chain
  // (FAILED) rather than succeeding — it moved no funds, so the refund was the only thing that moved
  // money. That is not a double-pay, and must not be alerted as one.
  it('D14: a row rolled back mid-pass whose raced tx mined FAILED does not alert DOUBLE PAY', async () => {
    const raceTxId = 'f'.repeat(64);
    const raced = await approvedWithdrawalWithPendingTx(new Date(Date.now() + 60_000), raceTxId, 'p1');

    const alerts: { message: string; context: AlertContext | undefined }[] = [];
    setAlertHandler((message, context) => {
      alerts.push({ message, context });
    });
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    const racyRevertedSource: WithdrawalTxSource = async (txHash) => {
      if (txHash === raceTxId) {
        await WithdrawalModel.updateOne({ _id: raced }, { $set: { state: WithdrawalState.ROLLED_BACK } });
      }
      return { status: 'FAILED', confirmations: 0 };
    };

    await checkWithdrawalsOnce(racyRevertedSource);

    // Assert on the spy's recorded calls BEFORE restoring — mockRestore() also clears call history.
    expect(alerts.find((a) => /DOUBLE PAY/.test(a.message))).toBeUndefined();
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringMatching(/refunded; tx reverted on chain — consistent/),
    );
    infoSpy.mockRestore();
    expect((await WithdrawalModel.findById(raced))!.state).toBe(WithdrawalState.ROLLED_BACK);
  });
});
