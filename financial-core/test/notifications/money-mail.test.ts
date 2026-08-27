import { Money } from '../../src/domain/money';
import { AccountType } from '../../src/domain/account-types';
import { AccountModel } from '../../src/wallet/account.model';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { NotificationModel } from '../../src/notifications/notification-store';
import { creditDeposit } from '../../src/deposit/deposit-credit';
import { requestWithdrawal } from '../../src/withdrawal/withdrawal-state-machine';
import { setRecipientResolver } from '../../src/notifications/email/money-mail';
import { EmailSendModel } from '../../src/notifications/email/send-email';
import { PlayerSettingsModel } from '../../src/settings/player-settings';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * [money] The money paths announce, and cannot be broken by announcing.
 *
 * The hooks sit on the deposit credit and the withdrawal state machine, so the
 * property that matters most is negative: nothing these do may fail, delay or
 * roll back the movement they are reporting. A player's deposit must land even
 * if the mail server is on fire and the address lookup throws.
 */

beforeAll(async () => {
  await startTestDb();
  await ensureIndexes(LedgerModel, AccountModel, NotificationModel, EmailSendModel, PlayerSettingsModel);
});
afterAll(stopTestDb);
afterEach(async () => {
  await clearCollections();
  // Back to the unresolved default between tests.
  setRecipientResolver(() => Promise.resolve(null));
});

async function player(ownerId: string, balance = '0', notifyDeposits = true): Promise<string> {
  const acc = await AccountModel.create({
    accountType: AccountType.PLAYER,
    ownerId,
    availableBalance: Money.fromDecimalString(balance).toDecimal128(),
  });
  
  // Set the player settings
  await PlayerSettingsModel.create({
    _id: ownerId,
    notifyDeposits
  });

  return acc._id;
}

describe('deposits announce after the credit', () => {
  it('raises an in-app notification carrying the exact amount', async () => {
    const accountId = await player('p-dep');
    await creditDeposit({
      playerAccountId: accountId,
      amount: Money.fromDecimalString('20'),
      txHash: 'tx-dep-1',
    });

    const note = await NotificationModel.findById('deposit:tx-dep-1').lean();
    expect(note).not.toBeNull();
    expect(note!.playerId).toBe('p-dep');
    expect(note!.kind).toBe('DEPOSIT');
    // The ledger's own string, not a re-rendered float.
    expect(note!.params.amount).toBe('20.000000');
  });

  it('announces once however many times the deposit is replayed', async () => {
    const accountId = await player('p-dep2');
    const deposit = {
      playerAccountId: accountId,
      amount: Money.fromDecimalString('5'),
      txHash: 'tx-dep-2',
    };
    await creditDeposit(deposit);
    await creditDeposit(deposit);
    await creditDeposit(deposit);

    // The tx hash is the credit's idempotency key, so the receipt is
    // idempotent on exactly what the money was idempotent on.
    expect(await NotificationModel.countDocuments({ _id: 'deposit:tx-dep-2' })).toBe(1);
  });

  it('still credits when the address lookup throws', async () => {
    // The gateway being down must not cost a player their deposit.
    setRecipientResolver(() => Promise.reject(new Error('user store unreachable')));
    const accountId = await player('p-dep3');

    const result = await creditDeposit({
      playerAccountId: accountId,
      amount: Money.fromDecimalString('50'),
      txHash: 'tx-dep-3',
    });

    expect(result.credited).toBe(true);
    const acc = await AccountModel.findById(accountId).lean();
    expect(Money.fromDecimal128(acc!.availableBalance).toString()).toBe('50.000000');
  });

  it('does not announce a deposit that was never credited', async () => {
    const accountId = await player('p-dep4');
    await creditDeposit({
      playerAccountId: accountId,
      amount: Money.fromDecimalString('1'),
      txHash: 'tx-dep-4',
    });
    await NotificationModel.deleteMany({});

    // Second call is a no-op replay: no money moved, so nothing is announced.
    const again = await creditDeposit({
      playerAccountId: accountId,
      amount: Money.fromDecimalString('1'),
      txHash: 'tx-dep-4',
    });
    expect(again.credited).toBe(false);
    expect(await NotificationModel.countDocuments({})).toBe(0);
  });

  it('suppresses the notification if the player has opted out in settings', async () => {
    // Create a player with notifyDeposits = false
    const accountId = await player('p-dep5', '0', false);
    await creditDeposit({
      playerAccountId: accountId,
      amount: Money.fromDecimalString('20'),
      txHash: 'tx-dep-5',
    });

    // Money is still credited, but NO notification is created
    const acc = await AccountModel.findById(accountId).lean();
    expect(Money.fromDecimal128(acc!.availableBalance).toString()).toBe('20.000000');
    expect(await NotificationModel.countDocuments({ _id: 'deposit:tx-dep-5' })).toBe(0);
  });
});

describe('withdrawals announce on request', () => {
  it('raises an unsuppressible SYSTEM notice', async () => {
    const accountId = await player('p-wd', '100');
    const id = await requestWithdrawal({
      playerAccountId: accountId,
      amount: Money.fromDecimalString('20'),
      address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    });

    const note = await NotificationModel.findById(`withdrawal:${id}:requested`).lean();
    expect(note).not.toBeNull();
    // SYSTEM, not DEPOSIT: this is the message that tells someone about a
    // withdrawal they did not make, so it must survive every mute toggle.
    expect(note!.kind).toBe('SYSTEM');
    expect(note!.params.amount).toBe('20.000000');
  });

  it('still records the withdrawal when announcing throws', async () => {
    setRecipientResolver(() => Promise.reject(new Error('user store unreachable')));
    const accountId = await player('p-wd2', '100');

    const id = await requestWithdrawal({
      playerAccountId: accountId,
      amount: Money.fromDecimalString('30'),
      address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    });
    expect(id).toBeTruthy();
  });

  it('does not announce a withdrawal the balance refused', async () => {
    const accountId = await player('p-wd3', '5');
    await expect(
      requestWithdrawal({
        playerAccountId: accountId,
        amount: Money.fromDecimalString('500'),
        address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      }),
    ).rejects.toThrow();

    expect(await NotificationModel.countDocuments({})).toBe(0);
  });
});
