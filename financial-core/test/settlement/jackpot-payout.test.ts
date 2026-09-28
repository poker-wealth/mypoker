import { Money } from '../../src/domain/money';
import { AccountType, LedgerType } from '../../src/domain/account-types';
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
    // the exact failure `updateOne` can throw directly.
    const duplicateKey = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    const spy = jest.spyOn(AccountModel, 'updateOne').mockImplementationOnce(() => {
      throw duplicateKey;
    });
    try {
      await expect(ensureJackpotAccounts(FRESH_TABLE, ids)).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
    // The other three tiers (not intercepted) were created normally by the same call.
    expect(await AccountModel.countDocuments({ ownerId: FRESH_TABLE })).toBe(3);
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
