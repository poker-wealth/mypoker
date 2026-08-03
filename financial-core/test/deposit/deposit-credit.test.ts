import { Decimal128 } from 'bson';
import { AccountModel } from '../../src/wallet/account.model';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { SecurityLogModel } from '../../src/security/security-log.model';
import { creditDeposit, processConfirmedDeposit } from '../../src/deposit/deposit-credit';
import { OFFICIAL_USDT_TRC20_CONTRACT } from '../../src/deposit/trc20';
import { Money } from '../../src/domain/money';
import { AccountType, LedgerType, LedgerDirection } from '../../src/domain/account-types';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

async function makePlayer(): Promise<string> {
  const a = await AccountModel.create({ accountType: AccountType.PLAYER, ownerId: 'p1' });
  return a._id;
}

async function avail(id: string): Promise<number> {
  const a = await AccountModel.findById(id);
  return parseFloat(a!.availableBalance.toString());
}

describe('deposit crediting (EXTERNAL → PLAYER)', () => {
  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes(AccountModel, LedgerModel, SecurityLogModel);
  });
  afterAll(stopTestDb);
  afterEach(clearCollections);

  it('credits a confirmed deposit and books a double-entry DEPOSIT pair', async () => {
    const player = await makePlayer();
    const res = await creditDeposit({
      playerAccountId: player,
      amount: Money.fromDecimalString('100'),
      txHash: 'tx-aaa',
    });

    expect(res.credited).toBe(true);
    expect(await avail(player)).toBe(100);
    // EXTERNAL goes negative by the deposited amount (it owes the player into the system).
    const external = await AccountModel.findOne({ accountType: AccountType.EXTERNAL });
    expect(parseFloat(external!.availableBalance.toString())).toBe(-100);

    const entries = await LedgerModel.find({ idempotencyKey: 'deposit:tx-aaa' });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.type === LedgerType.DEPOSIT)).toBe(true);
    expect(entries.find((e) => e.direction === LedgerDirection.CREDIT)!.accountId).toBe(player);
  });

  it('is idempotent on txHash — the same deposit is never credited twice', async () => {
    const player = await makePlayer();
    const input = { playerAccountId: player, amount: Money.fromDecimalString('100'), txHash: 'tx-dup' };

    const first = await creditDeposit(input);
    const second = await creditDeposit(input);

    expect(first.credited).toBe(true);
    expect(second.credited).toBe(false);
    expect(await avail(player)).toBe(100); // credited once
    expect(await LedgerModel.countDocuments({ idempotencyKey: 'deposit:tx-dup' })).toBe(2);
  });

  it('keeps Σ(DEBIT) = Σ(CREDIT) — deposit conserves at the boundary', async () => {
    const player = await makePlayer();
    await creditDeposit({ playerAccountId: player, amount: Money.fromDecimalString('250'), txHash: 'tx-bal' });
    const agg = await LedgerModel.aggregate<{ _id: LedgerDirection; total: Decimal128 }>([
      { $group: { _id: '$direction', total: { $sum: '$amount' } } },
    ]);
    const totals = Object.fromEntries(agg.map((r) => [r._id, r.total.toString()]));
    expect(totals[LedgerDirection.DEBIT]).toBe(totals[LedgerDirection.CREDIT]);
  });

  describe('processConfirmedDeposit gates', () => {
    it('never credits a deposit from a non-official contract (logs it instead)', async () => {
      const player = await makePlayer();
      const outcome = await processConfirmedDeposit({
        playerAccountId: player,
        amount: Money.fromDecimalString('100'),
        txHash: 'tx-bad',
        contractAddress: 'TXfakeContract000000000000000000000',
        confirmations: 50,
      });
      expect(outcome).toEqual({ credited: false, reason: 'wrong_contract' });
      expect(await avail(player)).toBe(0);
      expect(await SecurityLogModel.countDocuments({ event: 'NON_OFFICIAL_CONTRACT_DEPOSIT' })).toBe(1);
    });

    it('never credits an unconfirmed (mempool) deposit', async () => {
      const player = await makePlayer();
      const outcome = await processConfirmedDeposit({
        playerAccountId: player,
        amount: Money.fromDecimalString('100'),
        txHash: 'tx-pending',
        contractAddress: OFFICIAL_USDT_TRC20_CONTRACT,
        confirmations: 5, // < 20
      });
      expect(outcome).toEqual({ credited: false, reason: 'unconfirmed' });
      expect(await avail(player)).toBe(0);
    });

    it('credits once 20-block confirmed on the official contract', async () => {
      const player = await makePlayer();
      const outcome = await processConfirmedDeposit({
        playerAccountId: player,
        amount: Money.fromDecimalString('100'),
        txHash: 'tx-good',
        contractAddress: OFFICIAL_USDT_TRC20_CONTRACT,
        confirmations: 20,
      });
      expect(outcome).toEqual({ credited: true });
      expect(await avail(player)).toBe(100);
    });
  });
});
