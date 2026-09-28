import { Money } from '../../src/domain/money';
import { AccountType, LedgerType, PLATFORM_SCOPE } from '../../src/domain/account-types';
import { AccountModel } from '../../src/wallet/account.model';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { transfer } from '../../src/wallet/transfer';
import { getOrCreatePlayerAccount, ensureJackpotAccounts } from '../../src/wallet/system-accounts';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * [money] — the jackpot payout path.
 *
 * The clearing rules whitelisted JACKPOT_* → PLAYER from the beginning; this is
 * the first caller, so these tests prove the guards hold on the flow that will
 * actually run: the pool pays, the ledger records both sides, a replayed
 * trigger is a no-op, and an overdrawn pool CANNOT pay — the engine's in-memory
 * mirror may drift optimistic, but the ledger refuses what is not there.
 */

const TABLE = 'tx-test';
const POOLS = {
  mini: `jp:${TABLE}:mini`,
  minor: `jp:${TABLE}:minor`,
  major: `jp:${TABLE}:major`,
  grand: `jp:${TABLE}:grand`,
};

beforeAll(async () => {
  await startTestDb();
  await ensureIndexes(LedgerModel, AccountModel);
});
afterAll(stopTestDb);
afterEach(clearCollections);

async function fundPool(accountId: string, amount: string): Promise<void> {
  // Pools are funded in production by settlement's injection transfers; the
  // test funds them the same sanctioned way, from a player who "lost" into it.
  const funder = await getOrCreatePlayerAccount('p-funder');
  await AccountModel.updateOne({ _id: funder._id }, { $set: { availableBalance: Money.fromDecimalString('10000').toDecimal128() } });
  await transfer({
    fromAccountId: funder._id,
    toAccountId: accountId,
    amount: Money.fromDecimalString(amount),
    type: LedgerType.JACKPOT_INJECT,
    businessId: 'seed',
    idempotencyKey: `seed:${accountId}`,
  });
}

let winnerAccountId = '';

const payout = (amount: string, key = 'r-1:jackpot:mini') =>
  transfer({
    fromAccountId: POOLS.mini,
    toAccountId: winnerAccountId,
    amount: Money.fromDecimalString(amount),
    type: LedgerType.JACKPOT_PAYOUT,
    businessId: 'r-1',
    idempotencyKey: key,
  });

describe('ensureJackpotAccounts', () => {
  it('creates the four typed pool accounts, keyed to the table', async () => {
    await ensureJackpotAccounts(TABLE, POOLS);
    const mini = await AccountModel.findById(POOLS.mini).lean();
    expect(mini?.accountType).toBe(AccountType.JACKPOT_MINI);
    expect(mini?.ownerId).toBe(TABLE);
    expect(await AccountModel.countDocuments({ ownerId: TABLE })).toBe(4);
  });

  it('is idempotent — settling every hand re-ensures without duplicating', async () => {
    await ensureJackpotAccounts(TABLE, POOLS);
    await ensureJackpotAccounts(TABLE, POOLS);
    expect(await AccountModel.countDocuments({ ownerId: TABLE })).toBe(4);
  });

  // BUG-05: the game server names a table's pools two different ways (base-room.ts:
  // `jp:<tier>:<table>`; poker-room.ts: `jp:<table>:<tier>`), and the jackpot-payout route guesses a
  // third shape for the tiers it isn't paying. Whichever shape asks first wins the real `_id`; every
  // later call under a DIFFERENT shape for the same (accountType, ownerId, scope) must reuse that
  // same real account, not attempt to insert a second document under its own guessed id.
  it('reuses the existing pool account whatever id shape a later caller names it with', async () => {
    const shapeA = { mini: `jp:mini:${TABLE}`, minor: `jp:minor:${TABLE}`, major: `jp:major:${TABLE}`, grand: `jp:grand:${TABLE}` };
    const shapeB = { mini: `jp:${TABLE}:mini`, minor: `jp:${TABLE}:minor`, major: `jp:${TABLE}:major`, grand: `jp:${TABLE}:grand` };

    await ensureJackpotAccounts(TABLE, shapeA);
    await ensureJackpotAccounts(TABLE, shapeB); // must not throw E11000, and must not create a second set

    expect(await AccountModel.countDocuments({ ownerId: TABLE })).toBe(4);
    // The real accounts kept shapeA's ids — the first caller's shape won, not shapeB's.
    const mini = await AccountModel.findById(shapeA.mini).lean();
    expect(mini?.accountType).toBe(AccountType.JACKPOT_MINI);
    expect(await AccountModel.findById(shapeB.mini).lean()).toBeNull();
  });

  it('treats a duplicate-key error from a racing insert as success, not failure', async () => {
    const FRESH_TABLE = 'tx-test-race';
    const ids = {
      mini: `jp:mini:${FRESH_TABLE}`,
      minor: `jp:minor:${FRESH_TABLE}`,
      major: `jp:major:${FRESH_TABLE}`,
      grand: `jp:grand:${FRESH_TABLE}`,
    };
    // Simulates what two callers racing to ensure the same brand-new table's pools produce: both miss
    // the match, both attempt an insert, and the unique (accountType, ownerId, scope) index accepts
    // one and rejects the other with a duplicate-key error — a real race is timing-dependent and not
    // reliable to force through the public API against a real (if in-memory) Mongo, so this drives
    // the exact failure `updateOne` can throw directly. Success here hinges on the OTHER racer's
    // insert actually being there by the time the catch looks for it — planted up front, the same as
    // the winning racer's insert would have left behind for real.
    await AccountModel.create({
      _id: ids.mini,
      accountType: AccountType.JACKPOT_MINI,
      ownerId: FRESH_TABLE,
      scope: PLATFORM_SCOPE,
    });
    const duplicateKey = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    const spy = jest.spyOn(AccountModel, 'updateOne').mockImplementationOnce(() => {
      throw duplicateKey;
    });
    try {
      await expect(ensureJackpotAccounts(FRESH_TABLE, ids)).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
    // The other three tiers (not intercepted) were created normally by the same call, plus the one
    // the mock planted for mini — four real accounts, no duplicates.
    expect(await AccountModel.countDocuments({ ownerId: FRESH_TABLE })).toBe(4);
  });

  // BUG-05 follow-up: the catch above used to treat ANY E11000 as success, without checking that a
  // matching (accountType, ownerId, scope) account actually exists. That is right for the benign
  // upsert race (above), but wrong for a genuine id collision — `ids[tier]` colliding with some
  // OTHER, non-jackpot account's `_id` is a real bug and must not be swallowed as if it were the
  // same race.
  it('rethrows when the _id collision is a genuine conflict, not the benign upsert race', async () => {
    const FRESH_TABLE = 'tx-test-conflict';
    const ids = {
      mini: `jp:mini:${FRESH_TABLE}`,
      minor: `jp:minor:${FRESH_TABLE}`,
      major: `jp:major:${FRESH_TABLE}`,
      grand: `jp:grand:${FRESH_TABLE}`,
    };
    // Some unrelated, non-jackpot account already holds the exact id this table's mini pool would
    // use. Not this table's mini pool by any reading — not even a stranded legacy one, since a
    // legacy pool is still a JACKPOT_MINI account (see the legacy-pool test below).
    await AccountModel.create({
      _id: ids.mini,
      accountType: AccountType.PLAYER,
      ownerId: 'some-other-table',
      scope: PLATFORM_SCOPE,
    });

    await expect(ensureJackpotAccounts(FRESH_TABLE, ids)).rejects.toThrow();
    // The three uncontested tiers still got created — only the conflicting one is loud.
    expect(await AccountModel.countDocuments({ ownerId: FRESH_TABLE })).toBe(3);
  });

  // BUG-05 follow-up: live databases hold jackpot pools created before b1bd93c under tier-named
  // owners (see jackpot-pool-audit.ts) — e.g. `_id: 'jp:mini:niu-niu', accountType: JACKPOT_MINI,
  // ownerId: 'mini'`. For such a pool the (accountType, ownerId, scope) match above finds nothing
  // (ownerId is "mini", not the table), the upsert inserts the same _id, gets E11000, and
  // `conflicting` is that legacy doc. It IS this tier's pool — just stranded under the old owner
  // convention — so this must resolve, not throw, and must not create a second JACKPOT_MINI account
  // owned by the table.
  it('accepts a legacy jackpot pool created under a tier-named owner, without creating a duplicate', async () => {
    const TABLE_ID = 'T';
    const ids = {
      mini: `jp:mini:${TABLE_ID}`,
      minor: `jp:minor:${TABLE_ID}`,
      major: `jp:major:${TABLE_ID}`,
      grand: `jp:grand:${TABLE_ID}`,
    };
    await AccountModel.create({
      _id: ids.mini,
      accountType: AccountType.JACKPOT_MINI,
      ownerId: 'mini',
      scope: PLATFORM_SCOPE,
    });

    await expect(ensureJackpotAccounts(TABLE_ID, ids)).resolves.toBeUndefined();

    const jackpotDocs = await AccountModel.find({ _id: { $in: Object.values(ids) } }).lean();
    expect(jackpotDocs).toHaveLength(4);
    expect(await AccountModel.countDocuments({ accountType: AccountType.JACKPOT_MINI, ownerId: TABLE_ID })).toBe(0);
  });

  // BUG-05 follow-up: the legacy-pool console.warn above used to fire every time this branch was
  // hit — every hand, on every legacy table, forever. It must log once per process per pool, not
  // once per call.
  it('logs the legacy-pool reuse warning once per process, not once per call', async () => {
    const TABLE_ID = 'tx-test-legacy-log-once';
    const ids = {
      mini: `jp:mini:${TABLE_ID}`,
      minor: `jp:minor:${TABLE_ID}`,
      major: `jp:major:${TABLE_ID}`,
      grand: `jp:grand:${TABLE_ID}`,
    };
    await AccountModel.create({
      _id: ids.mini,
      accountType: AccountType.JACKPOT_MINI,
      ownerId: 'mini',
      scope: PLATFORM_SCOPE,
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await ensureJackpotAccounts(TABLE_ID, ids);
      await ensureJackpotAccounts(TABLE_ID, ids);

      const matchingCalls = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes(ids.mini),
      );
      expect(matchingCalls).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  // The same acceptance, without the tier-named-owner shape — a pool created at table creation
  // (settle-round.ts's JackpotAccounts, scripts/smoke.ts) can carry a random default _id under an
  // arbitrary owner unrelated to any tier name. Same-type, different-owner is still "this tier's
  // pool", not a conflict, whatever the owner string looks like.
  it('accepts a same-tier jackpot doc under an unrelated owner as an existing pool, not a conflict', async () => {
    const TABLE_ID = 'tx-test-legacy-owner';
    const ids = {
      mini: `jp:mini:${TABLE_ID}`,
      minor: `jp:minor:${TABLE_ID}`,
      major: `jp:major:${TABLE_ID}`,
      grand: `jp:grand:${TABLE_ID}`,
    };
    await AccountModel.create({
      _id: ids.mini,
      accountType: AccountType.JACKPOT_MINI,
      ownerId: 'demo-table', // arbitrary owner, not a tier name and not TABLE_ID
      scope: PLATFORM_SCOPE,
    });

    await expect(ensureJackpotAccounts(TABLE_ID, ids)).resolves.toBeUndefined();
    expect(await AccountModel.countDocuments({ accountType: AccountType.JACKPOT_MINI, ownerId: TABLE_ID })).toBe(0);
  });
});

describe('the payout', () => {
  beforeEach(async () => {
    await ensureJackpotAccounts(TABLE, POOLS);
    winnerAccountId = (await getOrCreatePlayerAccount('p-winner'))._id;
    await fundPool(POOLS.mini, '100');
  });

  it('moves pool → player through the ledger, both sides recorded', async () => {
    await payout('12');

    const pool = await AccountModel.findById(POOLS.mini).lean();
    const winner = await AccountModel.findById(winnerAccountId).lean();
    expect(Money.fromDecimal128(pool!.availableBalance).toString()).toBe('88.000000');
    expect(Money.fromDecimal128(winner!.availableBalance).toString()).toBe('12.000000');

    // Double-entry: exactly one matched DEBIT + CREDIT pair for the payout.
    const entries = await LedgerModel.find({ type: LedgerType.JACKPOT_PAYOUT }).lean();
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.direction))).toEqual(new Set(['DEBIT', 'CREDIT']));
  });

  it('a replayed trigger pays nothing twice', async () => {
    await payout('12');
    await payout('12'); // same idempotency key — settlement retry

    const winner = await AccountModel.findById(winnerAccountId).lean();
    expect(Money.fromDecimal128(winner!.availableBalance).toString()).toBe('12.000000');
  });

  it('an overdrawn pool CANNOT pay — the ledger is the authority, not the mirror', async () => {
    await expect(payout('150')).rejects.toThrow();

    const winner = await AccountModel.findById(winnerAccountId).lean();
    expect(Money.fromDecimal128(winner!.availableBalance).toString()).toBe('0.000000');
  });
});
