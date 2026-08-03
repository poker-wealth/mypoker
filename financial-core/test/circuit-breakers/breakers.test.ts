import { Decimal128 } from 'bson';
import {
  evaluateCB1,
  evaluateCB2,
  evaluateCB3,
  evaluateCB4,
  evaluateCB5,
  evaluateCB6,
  evaluateCB7,
  CB1_PLATFORM_THRESHOLD,
} from '../../src/circuit-breakers/breakers';
import { WithdrawalModel } from '../../src/withdrawal/withdrawal.model';
import { SecurityLogModel } from '../../src/security/security-log.model';
import { Money } from '../../src/domain/money';
import { AccountType } from '../../src/domain/account-types';
import { WithdrawalState } from '../../src/domain/withdrawal-types';
import {
  treasuryPath,
  insurancePath,
  jackpotPath,
  TreasuryTier,
} from '../../src/wallet/hd-derivation';
import { setAlertHandler } from '../../src/lib/alert';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

async function makeWithdrawals(playerAccountId: string, n: number): Promise<void> {
  await WithdrawalModel.create(
    Array.from({ length: n }, (_, i) => ({
      playerAccountId,
      amount: Decimal128.fromString('10'),
      address: `addr-${i}`,
      state: WithdrawalState.REQUESTED,
    })),
  );
}

describe('circuit breakers CB1–CB7', () => {
  let alerts: string[] = [];

  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes(WithdrawalModel, SecurityLogModel);
  });
  afterAll(stopTestDb);
  beforeEach(() => {
    alerts = [];
    setAlertHandler((msg) => {
      alerts.push(msg);
    });
  });
  afterEach(clearCollections);

  it('CB1 trips when the insurance pool is below its reserve', async () => {
    const low = await evaluateCB1(Money.fromDecimalString('9500'), CB1_PLATFORM_THRESHOLD);
    expect(low.tripped).toBe(true);
    expect(low.action).toBe('disable_insurance_sales');
    const ok = await evaluateCB1(Money.fromDecimalString('10000'), CB1_PLATFORM_THRESHOLD);
    expect(ok.tripped).toBe(false);
  });

  it('CB2 trips when daily payout exceeds 15% of the pool', async () => {
    const trip = await evaluateCB2(Money.fromDecimalString('160'), Money.fromDecimalString('1000'));
    expect(trip.tripped).toBe(true); // 160 > 150
    expect(trip.action).toBe('suspend_insurance_24h');
    const ok = await evaluateCB2(Money.fromDecimalString('150'), Money.fromDecimalString('1000'));
    expect(ok.tripped).toBe(false);
  });

  it('CB3 trips on the 3rd jackpot trigger within an hour on one table', async () => {
    expect((await evaluateCB3('t1', 3)).tripped).toBe(true);
    expect((await evaluateCB3('t1', 2)).tripped).toBe(false);
  });

  it('CB4 trips when one account exceeds its hourly withdrawal count', async () => {
    await makeWithdrawals('acc-hot', 6);
    const trip = await evaluateCB4('acc-hot', 5);
    expect(trip.tripped).toBe(true);
    expect(trip.action).toBe('freeze_account_withdrawals_1h');
    const ok = await evaluateCB4('acc-cool', 5);
    expect(ok.tripped).toBe(false);
  });

  it('CB5 trips when platform-wide hourly withdrawals exceed the threshold', async () => {
    await makeWithdrawals('a', 4);
    await makeWithdrawals('b', 4);
    expect((await evaluateCB5(5)).tripped).toBe(true); // 8 > 5
    expect((await evaluateCB5(50)).tripped).toBe(false);
  });

  it('CB6 trips on a non-whitelisted flow (and stays calm on a valid one)', async () => {
    const trip = await evaluateCB6(AccountType.PLAYER, AccountType.REINSURANCE);
    expect(trip.tripped).toBe(true);
    expect(trip.action).toBe('reject');
    expect((await evaluateCB6(AccountType.PLAYER, AccountType.TREASURY)).tripped).toBe(false);
  });

  it('CB7 trips when an address derivation path does not match its account type', async () => {
    // Treasury address presented as an insurance path → mismatch.
    const trip = await evaluateCB7(AccountType.INSURANCE, treasuryPath(TreasuryTier.HOT));
    expect(trip.tripped).toBe(true);
    expect(trip.action).toBe('abort_and_review');
    // Correct mappings stay calm.
    expect((await evaluateCB7(AccountType.INSURANCE, insurancePath())).tripped).toBe(false);
    expect((await evaluateCB7(AccountType.JACKPOT_MINI, jackpotPath(AccountType.JACKPOT_MINI, 0))).tripped).toBe(
      false,
    );
  });

  it('every trip writes a security_log entry and fires an ops alert', async () => {
    await evaluateCB6(AccountType.PLAYER, AccountType.REINSURANCE);
    expect(await SecurityLogModel.countDocuments({ event: 'CIRCUIT_BREAKER_CB6' })).toBe(1);
    expect(alerts.some((m) => m.includes('CB6'))).toBe(true);
  });
});
