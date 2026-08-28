import { Money } from '../../src/domain/money';
import { AccountType } from '../../src/domain/account-types';
import { AccountModel } from '../../src/wallet/account.model';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { NotificationModel } from '../../src/notifications/notification-store';
import { creditDeposit } from '../../src/deposit/deposit-credit';
import { requestWithdrawal } from '../../src/withdrawal/withdrawal-state-machine';
import { setRecipientResolver } from '../../src/notifications/email/money-mail';
import { EmailSendModel } from '../../src/notifications/email/send-email';
import * as email from '../../src/notifications/email/send-email';
import * as telegram from '../../src/notifications/telegram/send-telegram';
import * as settings from '../../src/settings/player-settings';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * [money] The money paths announce, and cannot be broken by announcing.
 *
 * The hooks sit on the deposit credit and the withdrawal state machine, so the
 * property that matters most is negative: nothing these do may fail, delay or
 * roll back the movement they are reporting. A player's deposit must land even
 * if the mail server is on fire and the address lookup throws.
 */

/**
 * Pass-through spies, not stubs: the channels behave exactly as they would
 * untouched, and these only record that they were reached at all. Whether a
 * message is SUPPRESSED cannot be read off the database — sendEmail with no
 * recipient and sendTelegram for a web account both write nothing and return a
 * normal outcome, so "no row" is indistinguishable from "never called". The
 * call itself is the only observable that separates them.
 *
 * `clearMocks` in jest.config.js resets the recorded calls before each test.
 */
const sendTelegramSpy = jest.spyOn(telegram, 'sendTelegram');
const sendEmailSpy = jest.spyOn(email, 'sendEmail');
const getSettingsSpy = jest.spyOn(settings, 'getSettings');

beforeAll(async () => {
  await startTestDb();
  await ensureIndexes(LedgerModel, AccountModel, NotificationModel, EmailSendModel);
});
afterAll(stopTestDb);
afterEach(async () => {
  await clearCollections();
  // Back to the unresolved default between tests.
  setRecipientResolver(() => Promise.resolve(null));
});

/**
 * A player with no settings row, which is the ordinary case — most accounts
 * never open Settings, and the defaults are what they are notified under.
 */
async function player(ownerId: string, balance = '0'): Promise<string> {
  const acc = await AccountModel.create({
    accountType: AccountType.PLAYER,
    ownerId,
    availableBalance: Money.fromDecimalString(balance).toDecimal128(),
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

  it('reaches both channels for a player who has not muted deposits', async () => {
    const accountId = await player('p-dep5');
    await creditDeposit({
      playerAccountId: accountId,
      amount: Money.fromDecimalString('20'),
      txHash: 'tx-dep-5',
    });

    // The control for the suppression test below. Without it, "was not called"
    // would go green against code that never called these in the first place.
    expect(sendTelegramSpy).toHaveBeenCalledWith('p-dep5', expect.any(String), 'deposit:tx-dep-5');
    expect(sendEmailSpy).toHaveBeenCalledWith(null, expect.anything(), 'deposit:tx-dep-5');
  });

  it('reaches no channel at all for a player who muted deposits', async () => {
    const accountId = await player('p-dep6');
    await settings.updateSettings('p-dep6', { notifyDeposits: false });

    const result = await creditDeposit({
      playerAccountId: accountId,
      amount: Money.fromDecimalString('20'),
      txHash: 'tx-dep-6',
    });

    // The money still moves. A muted receipt is not a declined deposit.
    expect(result.credited).toBe(true);
    const acc = await AccountModel.findById(accountId).lean();
    expect(Money.fromDecimal128(acc!.availableBalance).toString()).toBe('20.000000');

    // Telegram and email are the assertions that carry this test. notify()
    // has always suppressed the in-app row on its own, so checking only the
    // notifications collection would pass with no gate on the channels at all.
    expect(sendTelegramSpy).not.toHaveBeenCalled();
    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(await NotificationModel.countDocuments({ _id: 'deposit:tx-dep-6' })).toBe(0);
  });

  it('announces anyway when the preference cannot be read', async () => {
    // Fails open: a settings lookup that throws must not be read as consent to
    // say nothing about money that arrived.
    getSettingsSpy.mockRejectedValueOnce(new Error('settings unreachable'));
    const accountId = await player('p-dep7');

    await creditDeposit({
      playerAccountId: accountId,
      amount: Money.fromDecimalString('20'),
      txHash: 'tx-dep-7',
    });

    expect(sendTelegramSpy).toHaveBeenCalledWith('p-dep7', expect.any(String), 'deposit:tx-dep-7');
    expect(sendEmailSpy).toHaveBeenCalledWith(null, expect.anything(), 'deposit:tx-dep-7');
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
