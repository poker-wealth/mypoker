import { Decimal128 } from 'bson';
import { AccountModel } from '../../src/wallet/account.model';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { SecurityLogModel } from '../../src/security/security-log.model';
import { SettlementModel } from '../../src/settlement/settlement.model';
import { settleRound } from '../../src/settlement/settle-round';
import { TableType } from '../../src/settlement/settlement-domain';
import { Money } from '../../src/domain/money';
import { AccountType, LedgerDirection } from '../../src/domain/account-types';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

async function makeAccount(t: AccountType, ownerId: string, available = '0'): Promise<string> {
  const a = await AccountModel.create({
    accountType: t,
    ownerId,
    availableBalance: Decimal128.fromString(available),
  });
  return a._id;
}

async function avail(id: string): Promise<number> {
  const a = await AccountModel.findById(id);
  return parseFloat(a!.availableBalance.toString());
}

async function makeJackpotPools(tableId: string): Promise<{
  mini: string;
  minor: string;
  major: string;
  grand: string;
}> {
  return {
    mini: await makeAccount(AccountType.JACKPOT_MINI, tableId),
    minor: await makeAccount(AccountType.JACKPOT_MINOR, tableId),
    major: await makeAccount(AccountType.JACKPOT_MAJOR, tableId),
    grand: await makeAccount(AccountType.JACKPOT_GRAND, tableId),
  };
}

describe('settleRound() — Phase 1 settlement', () => {
  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes(AccountModel, LedgerModel, SecurityLogModel, SettlementModel);
  });
  afterAll(stopTestDb);
  afterEach(clearCollections);

  it('injects 0.5% jackpot (split 20/30/25/25) then rake — platform table', async () => {
    const winner = await makeAccount(AccountType.PLAYER, 'p-win', '2000');
    const treasury = await makeAccount(AccountType.TREASURY, 'PLATFORM');
    const pools = await makeJackpotPools('table-1');

    const receipt = await settleRound({
      roundId: 'r-1',
      tableType: TableType.PLATFORM,
      winnerAccountId: winner,
      winnerProfit: Money.fromDecimalString('1000'), // jackpot basis → 0.5% = 5
      rake: Money.fromDecimalString('50'),
      jackpotAccounts: pools,
    });

    // Jackpot total 5.0 split: mini 1.0 / minor 1.5 / major 1.25 / grand 1.25.
    expect(await avail(pools.mini)).toBe(1);
    expect(await avail(pools.minor)).toBe(1.5);
    expect(await avail(pools.major)).toBe(1.25);
    expect(await avail(pools.grand)).toBe(1.25);
    // Rake to treasury.
    expect(await avail(treasury)).toBe(50);
    // Winner paid 5 (jackpot) + 50 (rake) out of their winnings.
    expect(await avail(winner)).toBe(2000 - 55);

    // Receipt is well-formed.
    expect(receipt.sequence).toEqual(['jackpot_inject', 'rake', 'payout']);
    expect(receipt.accounts.rakeDest).toBe(treasury);
    expect(receipt.accounts.winner).toBe(winner);
    expect(receipt.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('routes rake to LEAGUE_INVENTORY for a league table (treasury untouched)', async () => {
    const winner = await makeAccount(AccountType.PLAYER, 'p-win', '2000');
    const treasury = await makeAccount(AccountType.TREASURY, 'PLATFORM');
    const leagueInv = await makeAccount(AccountType.LEAGUE_INVENTORY, 'league-1');
    const pools = await makeJackpotPools('table-L');

    await settleRound({
      roundId: 'r-league',
      tableType: TableType.LEAGUE,
      leagueId: 'league-1',
      winnerAccountId: winner,
      winnerProfit: Money.fromDecimalString('1000'),
      rake: Money.fromDecimalString('40'),
      jackpotAccounts: pools,
    });

    expect(await avail(leagueInv)).toBe(40);
    expect(await avail(treasury)).toBe(0); // platform treasury never touched by a league hand
  });

  it('splits jackpot to the exact micro-unit (remainder absorbed by Grand)', async () => {
    const winner = await makeAccount(AccountType.PLAYER, 'p-win', '100');
    await makeAccount(AccountType.TREASURY, 'PLATFORM');
    const pools = await makeJackpotPools('table-2');

    // 0.5% of 3.333 = 0.016665 → 16665 micro-units, not cleanly divisible by the 20/30/25/25 split.
    await settleRound({
      roundId: 'r-2',
      tableType: TableType.PLATFORM,
      winnerAccountId: winner,
      winnerProfit: Money.fromDecimalString('3.333'),
      rake: Money.ZERO,
      jackpotAccounts: pools,
    });

    const sumMicro = (
      await Promise.all(
        [pools.mini, pools.minor, pools.major, pools.grand].map(async (id) => {
          const a = await AccountModel.findById(id);
          return Money.fromDecimal128(a!.availableBalance).toMicros();
        }),
      )
    ).reduce((s, m) => s + m, 0n);

    // Parts reconcile exactly to 0.5% of 3.333 = 0.016665.
    expect(sumMicro).toBe(Money.fromDecimalString('0.016665').toMicros());
  });

  it('is idempotent per round — replay is a no-op returning the same receipt', async () => {
    const winner = await makeAccount(AccountType.PLAYER, 'p-win', '2000');
    await makeAccount(AccountType.TREASURY, 'PLATFORM');
    const pools = await makeJackpotPools('table-3');
    const input = {
      roundId: 'r-dup',
      tableType: TableType.PLATFORM,
      winnerAccountId: winner,
      winnerProfit: Money.fromDecimalString('1000'),
      rake: Money.fromDecimalString('50'),
      jackpotAccounts: pools,
    };

    const first = await settleRound(input);
    const second = await settleRound(input);

    expect(second.hash).toBe(first.hash);
    expect(await avail(winner)).toBe(2000 - 55); // applied once, not twice
    expect(await SettlementModel.countDocuments({ roundId: 'r-dup' })).toBe(1);
  });

  it('keeps the ledger balanced: Σ(DEBIT) = Σ(CREDIT)', async () => {
    const winner = await makeAccount(AccountType.PLAYER, 'p-win', '2000');
    await makeAccount(AccountType.TREASURY, 'PLATFORM');
    const pools = await makeJackpotPools('table-4');

    await settleRound({
      roundId: 'r-bal',
      tableType: TableType.PLATFORM,
      winnerAccountId: winner,
      winnerProfit: Money.fromDecimalString('1000'),
      rake: Money.fromDecimalString('50'),
      jackpotAccounts: pools,
    });

    const agg = await LedgerModel.aggregate<{ _id: LedgerDirection; total: Decimal128 }>([
      { $group: { _id: '$direction', total: { $sum: '$amount' } } },
    ]);
    const totals = Object.fromEntries(agg.map((r) => [r._id, r.total.toString()]));
    expect(totals[LedgerDirection.DEBIT]).toBe(totals[LedgerDirection.CREDIT]);
    // 4 jackpot injects + 1 rake = 5 transfers = 10 ledger rows.
    expect(await LedgerModel.countDocuments({})).toBe(10);
  });
});
