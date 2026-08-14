import {
  WithdrawalAddressModel,
  setWithdrawalAddress,
  assertWithdrawableAddress,
  WithdrawalAddressError,
} from '../../src/withdrawal/withdrawal-address';
import { startTestDb, stopTestDb } from '../db-helper';

/**
 * The 48h withdrawal-address cooldown (§3.6): withdrawals go only to the registered address, and a
 * change starts a cooldown before that address can receive funds — so a hijacked account can't
 * immediately redirect a payout.
 */
describe('withdrawal address 48h cooldown', () => {
  const A = 'TYgJ95nhTefUuoTYxEHvVCrfYvroGrSuSU';
  const B = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

  beforeAll(startTestDb);
  afterAll(stopTestDb);
  afterEach(async () => {
    await WithdrawalAddressModel.deleteMany({});
    delete process.env.WITHDRAWAL_ADDRESS_COOLDOWN_MS;
  });

  it('rejects a withdrawal when no address is registered', async () => {
    await expect(assertWithdrawableAddress('p1', A)).rejects.toBeInstanceOf(WithdrawalAddressError);
  });

  it('rejects an address that is not the registered one', async () => {
    process.env.WITHDRAWAL_ADDRESS_COOLDOWN_MS = '0';
    await setWithdrawalAddress('p1', A);
    await expect(assertWithdrawableAddress('p1', B)).rejects.toThrow(/registered/);
  });

  it('allows the registered address once the cooldown has elapsed', async () => {
    process.env.WITHDRAWAL_ADDRESS_COOLDOWN_MS = '0';
    await setWithdrawalAddress('p1', A);
    await expect(assertWithdrawableAddress('p1', A)).resolves.toBeUndefined();
  });

  it('blocks the registered address during the cooldown window after a change', async () => {
    process.env.WITHDRAWAL_ADDRESS_COOLDOWN_MS = String(60 * 60 * 1000); // 1h
    await setWithdrawalAddress('p1', A);
    await expect(assertWithdrawableAddress('p1', A)).rejects.toThrow(/cooldown/);
  });

  it('re-registering the SAME address does not restart the cooldown', async () => {
    process.env.WITHDRAWAL_ADDRESS_COOLDOWN_MS = '0';
    const first = await setWithdrawalAddress('p1', A);
    await new Promise((r) => setTimeout(r, 10));
    const again = await setWithdrawalAddress('p1', A);
    expect(again.updatedAt.getTime()).toBe(first.updatedAt.getTime());
  });
});
