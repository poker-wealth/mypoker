import { Decimal128 } from 'bson';
import { AccountModel } from '../../src/wallet/account.model';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { SettlementModel } from '../../src/settlement/settlement.model';
import { settleTableHand } from '../../src/settlement/table-settlement';
import { TableType } from '../../src/settlement/settlement-domain';
import { Money } from '../../src/domain/money';
import { AccountType, LedgerDirection } from '../../src/domain/account-types';
import { AccountNotFoundError, InsufficientBalanceError } from '../../src/wallet/errors';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

async function player(owner: string, locked: string): Promise<string> {
  const a = await AccountModel.create({
    accountType: AccountType.PLAYER,
    ownerId: owner,
    lockedBalance: Decimal128.fromString(locked),
  });
  return a._id;
}
async function locked(id: string): Promise<number> {
  return parseFloat((await AccountModel.findById(id))!.lockedBalance.toString());
}
async function available(id: string): Promise<number> {
  return parseFloat((await AccountModel.findById(id))!.availableBalance.toString());
}
async function pools(table: string): Promise<{ mini: string; minor: string; major: string; grand: string }> {
  return {
    mini: (await AccountModel.create({ accountType: AccountType.JACKPOT_MINI, ownerId: table }))._id,
    minor: (await AccountModel.create({ accountType: AccountType.JACKPOT_MINOR, ownerId: table }))._id,
    major: (await AccountModel.create({ accountType: AccountType.JACKPOT_MAJOR, ownerId: table }))._id,
    grand: (await AccountModel.create({ accountType: AccountType.JACKPOT_GRAND, ownerId: table }))._id,
  };
}

const m = (s: string): Money => Money.fromDecimalString(s);

describe('settleTableHand — multi-party settlement on locked balances', () => {
  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes(AccountModel, LedgerModel, SettlementModel);
  });
  afterAll(stopTestDb);
  afterEach(clearCollections);

  it('moves locked balances, credits house + jackpot, and keeps the ledger balanced', async () => {
    const p0 = await player('p0', '1000');
    const p1 = await player('p1', '1000');
    const p2 = await player('p2', '1000');
    const treasury = await AccountModel.create({ accountType: AccountType.TREASURY, ownerId: 'PLATFORM' });
    const jp = await pools('t1');

    const res = await settleTableHand({
      roundId: 'r-1',
      tableType: TableType.PLATFORM,
      losers: [{ accountId: p1, amount: m('1000') }, { accountId: p2, amount: m('1000') }],
      winners: [{ accountId: p0, amount: m('1840') }],
      rake: m('150'),
      jackpot: { mini: m('2'), minor: m('3'), major: m('2'), grand: m('3') },
      jackpotAccounts: jp,
    });
    expect(res.applied).toBe(true);

    expect(await locked(p0)).toBe(2840); // 1000 stake + 1840 net win
    expect(await locked(p1)).toBe(0);
    expect(await locked(p2)).toBe(0);
    expect(await available(treasury._id)).toBe(150); // rake
    expect(await available(jp.mini)).toBe(2);
    expect(await available(jp.grand)).toBe(3);

    // Double-entry stays balanced.
    const agg = await LedgerModel.aggregate<{ _id: LedgerDirection; total: Decimal128 }>([
      { $group: { _id: '$direction', total: { $sum: '$amount' } } },
    ]);
    const totals = Object.fromEntries(agg.map((r) => [r._id, r.total.toString()]));
    expect(totals[LedgerDirection.DEBIT]).toBe(totals[LedgerDirection.CREDIT]);
  });

  it('is idempotent per round', async () => {
    const p0 = await player('p0', '1000');
    const p1 = await player('p1', '1000');
    await AccountModel.create({ accountType: AccountType.TREASURY, ownerId: 'PLATFORM' });
    const jp = await pools('t2');
    const input = {
      roundId: 'r-dup',
      tableType: TableType.PLATFORM,
      losers: [{ accountId: p1, amount: m('1000') }],
      winners: [{ accountId: p0, amount: m('950') }],
      rake: m('50'),
      jackpot: { mini: m('0'), minor: m('0'), major: m('0'), grand: m('0') },
      jackpotAccounts: jp,
    };
    const first = await settleTableHand(input);
    const second = await settleTableHand(input);
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(await locked(p0)).toBe(1950); // applied once
  });

  it('refuses a settlement that is not conserved', async () => {
    const p0 = await player('p0', '1000');
    const p1 = await player('p1', '1000');
    const jp = await pools('t3');
    await expect(
      settleTableHand({
        roundId: 'r-bad',
        tableType: TableType.PLATFORM,
        losers: [{ accountId: p1, amount: m('1000') }],
        winners: [{ accountId: p0, amount: m('500') }], // 500 + 0 rake + 0 jp ≠ 1000
        rake: m('0'),
        jackpot: { mini: m('0'), minor: m('0'), major: m('0'), grand: m('0') },
        jackpotAccounts: jp,
      }),
    ).rejects.toThrow(/not conserved/);
  });

  it('rejects a loser who lacks the locked funds', async () => {
    const p0 = await player('p0', '1000');
    const p1 = await player('p1', '100'); // only 100 locked, but settlement says they lost 1000
    const jp = await pools('t4');
    await expect(
      settleTableHand({
        roundId: 'r-short',
        tableType: TableType.PLATFORM,
        losers: [{ accountId: p1, amount: m('1000') }],
        winners: [{ accountId: p0, amount: m('1000') }],
        rake: m('0'),
        jackpot: { mini: m('0'), minor: m('0'), major: m('0'), grand: m('0') },
        jackpotAccounts: jp,
      }),
    ).rejects.toThrow(InsufficientBalanceError);
  });

  // BUG-17: a winner/pool credit's updateOne used to ignore matchedCount, so
  // a bogus account id silently no-opped the credit instead of aborting —
  // the loser's debit still landed, breaking conservation with no trace.
  it('throws and leaves losers untouched when a winner account does not exist', async () => {
    const p1 = await player('p1', '1000');
    await AccountModel.create({ accountType: AccountType.TREASURY, ownerId: 'PLATFORM' });
    const jp = await pools('t5');

    await expect(
      settleTableHand({
        roundId: 'r-bad-winner',
        tableType: TableType.PLATFORM,
        losers: [{ accountId: p1, amount: m('1000') }],
        winners: [{ accountId: 'no-such-account', amount: m('950') }],
        rake: m('50'),
        jackpot: { mini: m('0'), minor: m('0'), major: m('0'), grand: m('0') },
        jackpotAccounts: jp,
      }),
    ).rejects.toThrow(AccountNotFoundError);

    // The transaction aborted — the loser's stake was never actually moved.
    expect(await locked(p1)).toBe(1000);
    expect(await SettlementModel.findOne({ roundId: 'r-bad-winner' })).toBeNull();
  });

  it('throws and leaves losers untouched when a jackpot pool account does not exist', async () => {
    const p0 = await player('p0', '1000');
    const p1 = await player('p1', '1000');
    await AccountModel.create({ accountType: AccountType.TREASURY, ownerId: 'PLATFORM' });
    const jp = await pools('t6');

    await expect(
      settleTableHand({
        roundId: 'r-bad-pool',
        tableType: TableType.PLATFORM,
        losers: [{ accountId: p1, amount: m('1000') }],
        winners: [{ accountId: p0, amount: m('995') }],
        rake: m('0'),
        // mini set to a nonexistent pool id; the other three are real.
        jackpot: { mini: m('5'), minor: m('0'), major: m('0'), grand: m('0') },
        jackpotAccounts: { ...jp, mini: 'no-such-pool' },
      }),
    ).rejects.toThrow(AccountNotFoundError);

    expect(await locked(p1)).toBe(1000);
    expect(await locked(p0)).toBe(1000);
    expect(await SettlementModel.findOne({ roundId: 'r-bad-pool' })).toBeNull();
  });
});
