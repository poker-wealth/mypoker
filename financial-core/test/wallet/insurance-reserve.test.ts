import { Money } from '../../src/domain/money';
import { LedgerType } from '../../src/domain/account-types';
import { AccountModel } from '../../src/wallet/account.model';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { transfer } from '../../src/wallet/transfer';
import { getOrCreatePlayerAccount } from '../../src/wallet/system-accounts';
import {
  insuranceAccountId,
  reinsuranceAccountId,
} from '../../src/wallet/system-accounts';
import { getInsuranceReserve } from '../../src/wallet/insurance-reserve';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * [money] — the insurance reserve facts (§4).
 *
 * These figures replace INSURANCE_RESERVE_PLACEHOLDER: the underwriting
 * engine's health check, single-payout cap and daily budget are all arithmetic
 * on what this returns. The tests prove the three properties that make that
 * safe: the balance is the pool's real ledger balance, today's outflow is read
 * back from the ledger rather than remembered, and the two systems (platform /
 * league) cannot see each other's pools.
 */

beforeAll(async () => {
  await startTestDb();
  await ensureIndexes(LedgerModel, AccountModel);
});
afterAll(stopTestDb);
afterEach(clearCollections);

/** Fund a pool the sanctioned way — through transfer(), never by editing balances. */
async function fundInsurance(ownerId: string, amount: string): Promise<void> {
  await getInsuranceReserve(ownerId); // ensures the accounts exist
  const funder = await getOrCreatePlayerAccount('p-funder');
  await AccountModel.updateOne(
    { _id: funder._id },
    { $set: { availableBalance: Money.fromDecimalString('100000').toDecimal128() } },
  );
  await transfer({
    fromAccountId: funder._id,
    toAccountId: insuranceAccountId(ownerId),
    amount: Money.fromDecimalString(amount),
    type: LedgerType.INSURANCE_PREMIUM,
    businessId: 'seed',
    idempotencyKey: `seed:ins:${ownerId}:${amount}`,
  });
}

describe('getInsuranceReserve', () => {
  it('reports an empty pool as empty — the fail-closed default', async () => {
    const facts = await getInsuranceReserve('PLATFORM');
    expect(facts.insuranceBalance).toBe('0.000000');
    expect(facts.reinsuranceBalance).toBe('0.000000');
    expect(facts.todayPaidOut).toBe('0.000000');
    // The accounts now exist, so a later premium/payout transfer cannot throw
    // AccountNotFoundError — the jackpot bug, prevented here by construction.
    expect(await AccountModel.findById(insuranceAccountId('PLATFORM')).lean()).not.toBeNull();
    expect(await AccountModel.findById(reinsuranceAccountId('PLATFORM')).lean()).not.toBeNull();
  });

  it('reports the pool’s real ledger balance', async () => {
    await fundInsurance('PLATFORM', '25000');
    const facts = await getInsuranceReserve('PLATFORM');
    expect(facts.insuranceBalance).toBe('25000.000000');
  });

  it('counts today’s payouts from the ledger, not a counter', async () => {
    await fundInsurance('PLATFORM', '25000');
    const player = await getOrCreatePlayerAccount('p-insured');
    await transfer({
      fromAccountId: insuranceAccountId('PLATFORM'),
      toAccountId: player._id,
      amount: Money.fromDecimalString('1200'),
      type: LedgerType.INSURANCE_PAYOUT,
      businessId: 'r-ins-1',
      idempotencyKey: 'r-ins-1:insurance',
    });

    const facts = await getInsuranceReserve('PLATFORM');
    expect(facts.todayPaidOut).toBe('1200.000000');
    // And the balance moved with it — the same event, seen from both sides.
    expect(facts.insuranceBalance).toBe('23800.000000');
  });

  it('keeps the two systems’ pools invisible to each other (§2: no cross-subsidy)', async () => {
    await fundInsurance('PLATFORM', '25000');
    await fundInsurance('league-macau', '3000');

    const platform = await getInsuranceReserve('PLATFORM');
    const league = await getInsuranceReserve('league-macau');

    expect(platform.insuranceBalance).toBe('25000.000000');
    expect(league.insuranceBalance).toBe('3000.000000');
    // A league quoting against the platform's reserve would underwrite risk
    // with money that is not the league's to risk.
  });

  it('cannot pay the pool below zero through the payout path', async () => {
    await fundInsurance('PLATFORM', '100');
    const player = await getOrCreatePlayerAccount('p-insured');
    await expect(
      transfer({
        fromAccountId: insuranceAccountId('PLATFORM'),
        toAccountId: player._id,
        amount: Money.fromDecimalString('500'),
        type: LedgerType.INSURANCE_PAYOUT,
        businessId: 'r-ins-2',
        idempotencyKey: 'r-ins-2:insurance',
      }),
    ).rejects.toThrow();
  });
});
