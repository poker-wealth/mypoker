import { Decimal128 } from 'bson';
import { getPlayerStats, getPlayerHistory, periodStart } from '../../src/stats/player-stats';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { getOrCreatePlayerAccount } from '../../src/wallet/system-accounts';
import { LedgerType, LedgerDirection } from '../../src/domain/account-types';
import { AccountModel } from '../../src/wallet/account.model';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * These cover the derivation, which is where this can be quietly wrong: the
 * numbers look plausible whatever the query does, so an error here ships.
 */

const PLAYER = 'p-stats-test';

let accountId: string;

beforeAll(async () => {
  await startTestDb();
  await ensureIndexes(LedgerModel, AccountModel);
});
afterAll(stopTestDb);
afterEach(clearCollections);

beforeEach(async () => {
  const account = await getOrCreatePlayerAccount(PLAYER);
  accountId = account._id;
});

/** Write one side of a ledger movement, as the settlement engine would. */
async function entry(opts: {
  roundId: string;
  type: LedgerType;
  direction: LedgerDirection;
  amount: string;
  at?: Date;
}): Promise<void> {
  await LedgerModel.create({
    _id: `${opts.roundId}-${opts.type}-${opts.direction}-${Math.random()}`,
    idempotencyKey: `${opts.roundId}-${opts.type}-${opts.direction}-${Math.random()}`,
    businessId: opts.roundId,
    accountId,
    counterpartyAccountId: 'house',
    direction: opts.direction,
    amount: Decimal128.fromString(opts.amount),
    type: opts.type,
    createdAt: opts.at ?? new Date(),
  });
}

/** One round the player lost: they bet and got nothing back. */
async function lostRound(roundId: string, stake: string, at?: Date): Promise<void> {
  await entry({ roundId, type: LedgerType.BET, direction: LedgerDirection.DEBIT, amount: stake, ...(at ? { at } : {}) });
}

/** One round the player won: they bet, and were paid out more. */
async function wonRound(roundId: string, stake: string, payout: string, at?: Date): Promise<void> {
  await entry({ roundId, type: LedgerType.BET, direction: LedgerDirection.DEBIT, amount: stake, ...(at ? { at } : {}) });
  await entry({ roundId, type: LedgerType.WIN_PAYOUT, direction: LedgerDirection.CREDIT, amount: payout, ...(at ? { at } : {}) });
}

describe('getPlayerStats', () => {
  it('reports zeros for a player who has never played', async () => {
    const stats = await getPlayerStats(PLAYER);

    expect(stats.handsPlayed).toBe(0);
    expect(stats.handsWon).toBe(0);
    // Null, not '0.0' — a player with no hands has no win rate, and showing 0%
    // would read as "you lose every hand".
    expect(stats.winRate).toBeNull();
    expect(stats.netProfit).toBe('0.000000');
  });

  it('counts one hand per round, not per ledger entry', async () => {
    // A won round writes two entries. Counting entries would report 2 hands.
    await wonRound('r1', '10', '25');

    const stats = await getPlayerStats(PLAYER);
    expect(stats.handsPlayed).toBe(1);
    expect(stats.handsWon).toBe(1);
  });

  it('computes win rate over rounds played', async () => {
    await wonRound('r1', '10', '25');
    await lostRound('r2', '10');
    await lostRound('r3', '10');
    await wonRound('r4', '10', '15');

    const stats = await getPlayerStats(PLAYER);
    expect(stats.handsPlayed).toBe(4);
    expect(stats.handsWon).toBe(2);
    expect(stats.winRate).toBe('50.0');
  });

  it('nets profit across wins and losses', async () => {
    await wonRound('r1', '10', '25'); // +15
    await lostRound('r2', '10'); //      -10

    const stats = await getPlayerStats(PLAYER);
    expect(stats.netProfit).toBe('5.000000');
  });

  it('reports a negative net profit when the player is down', async () => {
    await lostRound('r1', '40');
    await wonRound('r2', '10', '15'); // +5

    const stats = await getPlayerStats(PLAYER);
    expect(stats.netProfit).toBe('-35.000000');
  });

  it('takes biggest win from the round net, not the gross payout', async () => {
    await wonRound('r1', '5', '50'); //   net +45
    await wonRound('r2', '90', '100'); // net +10, bigger payout, smaller win

    const stats = await getPlayerStats(PLAYER);
    expect(stats.biggestWin).toBe('45.000000');
  });

  it('excludes deposits and withdrawals from profit', async () => {
    // The one that matters: counting a deposit as profit would make every
    // top-up look like a win, and the number would be meaningless.
    await entry({ roundId: 'd1', type: LedgerType.DEPOSIT, direction: LedgerDirection.CREDIT, amount: '1000' });
    await entry({ roundId: 'w1', type: LedgerType.WITHDRAW, direction: LedgerDirection.DEBIT, amount: '200' });
    await lostRound('r1', '10');

    const stats = await getPlayerStats(PLAYER);
    expect(stats.handsPlayed).toBe(1);
    expect(stats.netProfit).toBe('-10.000000');
  });

  it('sums raw staked volume from bets only, not rake or payouts', async () => {
    await entry({ roundId: 'r1', type: LedgerType.BET, direction: LedgerDirection.DEBIT, amount: '10' });
    await entry({ roundId: 'r1', type: LedgerType.WIN_PAYOUT, direction: LedgerDirection.CREDIT, amount: '25' });
    await entry({ roundId: 'r1', type: LedgerType.RAKE, direction: LedgerDirection.DEBIT, amount: '1' });
    await lostRound('r2', '30');

    const stats = await getPlayerStats(PLAYER);
    // 10 + 30 staked. Rake is a cost, not volume; the payout is not volume at all.
    expect(stats.cumulativeVolumeRaw).toBe('40.000000');
  });

  it('counts rake against the player', async () => {
    await entry({ roundId: 'r1', type: LedgerType.BET, direction: LedgerDirection.DEBIT, amount: '10' });
    await entry({ roundId: 'r1', type: LedgerType.WIN_PAYOUT, direction: LedgerDirection.CREDIT, amount: '25' });
    await entry({ roundId: 'r1', type: LedgerType.RAKE, direction: LedgerDirection.DEBIT, amount: '1' });

    const stats = await getPlayerStats(PLAYER);
    expect(stats.netProfit).toBe('14.000000');
  });

  it('ignores another player entirely', async () => {
    await wonRound('r1', '10', '25');
    const other = await getOrCreatePlayerAccount('p-someone-else');
    await LedgerModel.create({
      _id: 'other-1',
      idempotencyKey: 'other-1',
      businessId: 'r99',
      accountId: other._id,
      counterpartyAccountId: 'house',
      direction: LedgerDirection.CREDIT,
      amount: Decimal128.fromString('9999'),
      type: LedgerType.WIN_PAYOUT,
    });

    const stats = await getPlayerStats(PLAYER);
    expect(stats.handsPlayed).toBe(1);
    expect(stats.netProfit).toBe('15.000000');
  });
});

describe('getPlayerHistory', () => {
  it('is empty for a player who has never played', async () => {
    const page = await getPlayerHistory(PLAYER);
    expect(page.entries).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('returns rounds newest first with their signed net', async () => {
    const base = Date.now();
    await lostRound('older', '10', new Date(base - 60_000));
    await wonRound('newer', '10', '30', new Date(base));

    const page = await getPlayerHistory(PLAYER);

    expect(page.entries.map((e) => e.roundId)).toEqual(['newer', 'older']);
    expect(page.entries[0]!.net).toBe('20.000000');
    expect(page.entries[0]!.won).toBe(true);
    expect(page.entries[1]!.net).toBe('-10.000000');
    expect(page.entries[1]!.won).toBe(false);
  });

  it('pages without repeating or skipping a round', async () => {
    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      await lostRound(`r${i}`, '10', new Date(base - i * 60_000));
    }

    const first = await getPlayerHistory(PLAYER, { limit: 2 });
    expect(first.entries.map((e) => e.roundId)).toEqual(['r0', 'r1']);
    expect(first.nextCursor).not.toBeNull();

    const second = await getPlayerHistory(PLAYER, { limit: 2, cursor: first.nextCursor! });
    expect(second.entries.map((e) => e.roundId)).toEqual(['r2', 'r3']);

    const third = await getPlayerHistory(PLAYER, { limit: 2, cursor: second.nextCursor! });
    expect(third.entries.map((e) => e.roundId)).toEqual(['r4']);
    expect(third.nextCursor).toBeNull();
  });

  it('rejects a malformed cursor rather than silently returning page one', async () => {
    await expect(getPlayerHistory(PLAYER, { cursor: 'not-a-date' })).rejects.toThrow(RangeError);
  });
});

/**
 * Period filtering. The failure mode here is silent: a wrong boundary still
 * returns plausible numbers, just for the wrong window, and nothing errors.
 *
 * The clock is passed in rather than mocked — jest fake timers freeze the timers
 * Mongo drives its connection on, and the queries below simply never return.
 */
describe('reporting periods', () => {
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const NOW = new Date('2026-06-15T12:00:00.000Z');

  beforeEach(async () => {
    await wonRound('r-today', '10', '30', new Date(NOW.getTime() - 2 * HOUR));
    await wonRound('r-3d', '10', '20', new Date(NOW.getTime() - 3 * DAY));
    await lostRound('r-20d', '10', new Date(NOW.getTime() - 20 * DAY));
    await lostRound('r-90d', '10', new Date(NOW.getTime() - 90 * DAY));
  });

  it('bounds each window at the right instant', () => {
    expect(periodStart('all', NOW)).toBeUndefined();
    // Midnight UTC of the same day, not 24 hours back.
    expect(periodStart('today', NOW)?.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(periodStart('7d', NOW)?.toISOString()).toBe('2026-06-08T12:00:00.000Z');
    expect(periodStart('30d', NOW)?.toISOString()).toBe('2026-05-16T12:00:00.000Z');
  });

  it('counts only rounds inside the window', async () => {
    expect((await getPlayerStats(PLAYER, { period: 'today', now: NOW })).handsPlayed).toBe(1);
    expect((await getPlayerStats(PLAYER, { period: '7d', now: NOW })).handsPlayed).toBe(2);
    expect((await getPlayerStats(PLAYER, { period: '30d', now: NOW })).handsPlayed).toBe(3);
    expect((await getPlayerStats(PLAYER, { period: 'all', now: NOW })).handsPlayed).toBe(4);
  });

  it('sums profit over the window only, not all time', async () => {
    // today: staked 10, paid 30 -> +20
    expect((await getPlayerStats(PLAYER, { period: 'today', now: NOW })).netProfit).toBe('20.000000');
    // 7d adds the 3-day round (+10) -> +30
    expect((await getPlayerStats(PLAYER, { period: '7d', now: NOW })).netProfit).toBe('30.000000');
    // 30d adds a 10 loss -> +20
    expect((await getPlayerStats(PLAYER, { period: '30d', now: NOW })).netProfit).toBe('20.000000');
    // all time adds another 10 loss -> +10
    expect((await getPlayerStats(PLAYER, { period: 'all', now: NOW })).netProfit).toBe('10.000000');
  });

  it('defaults to all time when no period is given', async () => {
    expect((await getPlayerStats(PLAYER)).handsPlayed).toBe(4);
  });

  it('filters history by period as well as stats', async () => {
    const week = await getPlayerHistory(PLAYER, { period: '7d', now: NOW });
    expect(week.entries.map((e) => e.roundId).sort()).toEqual(['r-3d', 'r-today']);
  });

  it('paginates within a period rather than escaping it', async () => {
    const first = await getPlayerHistory(PLAYER, { period: '30d', now: NOW, limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    // Page two must stay inside 30d and must not reach the 90-day round.
    const second = await getPlayerHistory(PLAYER, {
      period: '30d',
      now: NOW,
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.entries.map((e) => e.roundId)).toEqual(['r-20d']);
    expect(second.nextCursor).toBeNull();
  });
});
