import { Decimal128 } from 'bson';
import {
  getReputation,
  deductReputation,
  bandFor,
  ReputationDeductionModel,
  STARTING_SCORE,
  CLEAN_ROUNDS_FOR_ADVANCE,
} from '../../src/reputation/player-reputation';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { AccountModel } from '../../src/wallet/account.model';
import { getOrCreatePlayerAccount } from '../../src/wallet/system-accounts';
import { LedgerType, LedgerDirection } from '../../src/domain/account-types';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * The spec calls a reputation score affecting a withdrawal a critical failure,
 * so the last describe block below is the important one: it asserts the module
 * cannot reach the withdrawal path at all, rather than trusting that nobody will
 * wire it up later.
 */

const PLAYER = 'p-reputation-test';
let accountId: string;

beforeAll(async () => {
  await startTestDb();
  await ensureIndexes(LedgerModel, AccountModel);
});
afterAll(stopTestDb);
afterEach(clearCollections);

beforeEach(async () => {
  accountId = (await getOrCreatePlayerAccount(PLAYER))._id;
});

/** Play `n` rounds, as settlement would record them. */
async function playRounds(n: number): Promise<void> {
  const docs = Array.from({ length: n }, (_, i) => ({
    _id: `rep-r${i}`,
    idempotencyKey: `rep-r${i}`,
    businessId: `rep-round-${i}`,
    accountId,
    counterpartyAccountId: 'house',
    direction: LedgerDirection.DEBIT,
    amount: Decimal128.fromString('1'),
    type: LedgerType.BET,
    createdAt: new Date(),
  }));
  await LedgerModel.insertMany(docs);
}

describe('starting position', () => {
  it('starts a new account at 500', async () => {
    const rep = await getReputation(PLAYER);
    expect(rep.score).toBe(STARTING_SCORE);
    expect(rep.roundsPlayed).toBe(0);
    expect(rep.roundsToAdvance).toBe(CLEAN_ROUNDS_FOR_ADVANCE);
  });

  it('puts a new account in FAIR, not at the bottom', async () => {
    // 500 must not read as a bad score — everyone starts there.
    expect((await getReputation(PLAYER)).band).toBe('FAIR');
  });
});

describe('the 100-round auto-advance', () => {
  it('does not advance at 99 rounds', async () => {
    await playRounds(99);
    const rep = await getReputation(PLAYER);
    expect(rep.score).toBe(500);
    expect(rep.roundsToAdvance).toBe(1);
  });

  it('advances to 700 at exactly 100 rounds, with no manual trigger', async () => {
    await playRounds(CLEAN_ROUNDS_FOR_ADVANCE);
    const rep = await getReputation(PLAYER);
    expect(rep.score).toBe(700);
    expect(rep.band).toBe('TRUSTED');
    expect(rep.roundsToAdvance).toBe(0);
  });

  it('does not keep climbing past 700', async () => {
    await playRounds(500);
    expect((await getReputation(PLAYER)).score).toBe(700);
  });
});

describe('deductions', () => {
  it('applies the spec amounts exactly', async () => {
    expect((await deductReputation({ playerId: PLAYER, reason: 'VERIFICATION_FAILED', confirmedBy: 'ops', findingId: 'f1' })).score).toBe(480);
    expect((await deductReputation({ playerId: PLAYER, reason: 'BOT_CONFIRMED', confirmedBy: 'ops', findingId: 'f2' })).score).toBe(330);
    expect((await deductReputation({ playerId: PLAYER, reason: 'COLLUSION_CONFIRMED', confirmedBy: 'ops', findingId: 'f3' })).score).toBe(130);
  });

  it('puts a confirmed colluder in VERY_POOR, as the spec names it', async () => {
    const rep = await deductReputation({ playerId: PLAYER, reason: 'COLLUSION_CONFIRMED', confirmedBy: 'ops', findingId: 'f1' });
    expect(rep.score).toBe(300);
    expect(rep.band).toBe('VERY_POOR');
  });

  it('will not dock the same finding twice', async () => {
    await deductReputation({ playerId: PLAYER, reason: 'BOT_CONFIRMED', confirmedBy: 'ops', findingId: 'same-finding' });
    const again = await deductReputation({ playerId: PLAYER, reason: 'BOT_CONFIRMED', confirmedBy: 'ops', findingId: 'same-finding' });

    // A retried ops action, or a replayed queue message, must not compound.
    expect(again.score).toBe(350);
    expect(await ReputationDeductionModel.countDocuments({ playerId: PLAYER })).toBe(1);
  });

  it('never goes below zero', async () => {
    for (let i = 0; i < 5; i++) {
      await deductReputation({ playerId: PLAYER, reason: 'COLLUSION_CONFIRMED', confirmedBy: 'ops', findingId: `f${i}` });
    }
    expect((await getReputation(PLAYER)).score).toBe(0);
  });

  it('deducts from the advanced score, not the starting one', async () => {
    await playRounds(CLEAN_ROUNDS_FOR_ADVANCE);
    const rep = await deductReputation({ playerId: PLAYER, reason: 'VERIFICATION_FAILED', confirmedBy: 'ops', findingId: 'f1' });
    expect(rep.score).toBe(680);
  });

  it('keeps one player’s deductions off another', async () => {
    await deductReputation({ playerId: PLAYER, reason: 'COLLUSION_CONFIRMED', confirmedBy: 'ops', findingId: 'f1' });
    expect((await getReputation('p-someone-else')).score).toBe(500);
  });
});

describe('bands', () => {
  it('maps each score to its band', () => {
    expect(bandFor(700)).toBe('TRUSTED');
    expect(bandFor(699)).toBe('GOOD');
    expect(bandFor(600)).toBe('GOOD');
    expect(bandFor(599)).toBe('FAIR');
    expect(bandFor(500)).toBe('FAIR');
    expect(bandFor(499)).toBe('POOR');
    expect(bandFor(350)).toBe('POOR');
    expect(bandFor(349)).toBe('VERY_POOR');
    expect(bandFor(0)).toBe('VERY_POOR');
  });
});

describe('IRON RULE: reputation never blocks funds', () => {
  it('is not imported by any withdrawal or balance module', () => {
    // A static check, deliberately. Any import is the beginning of a branch on
    // reputation somewhere in the money path, and the spec calls that a critical
    // failure — so it should fail here, at the boundary, not in review.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');

    const moneyDirs = ['withdrawal', 'wallet', 'settlement', 'deposit', 'clearing'];
    const offenders: string[] = [];

    for (const dir of moneyDirs) {
      const full = path.join(__dirname, '..', '..', 'src', dir);
      if (!fs.existsSync(full)) continue;
      for (const file of fs.readdirSync(full)) {
        if (!file.endsWith('.ts')) continue;
        const source = fs.readFileSync(path.join(full, file), 'utf8');
        if (/from\s+['"].*reputation/.test(source)) offenders.push(`${dir}/${file}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('exposes nothing a withdrawal could gate on', async () => {
    await deductReputation({ playerId: PLAYER, reason: 'COLLUSION_CONFIRMED', confirmedBy: 'ops', findingId: 'f1' });
    const rep = await getReputation(PLAYER);

    // Worst possible standing, and the shape still carries no permission flag —
    // no `canWithdraw`, no `blocked`, no `restricted`. There is nothing to read.
    expect(rep.band).toBe('VERY_POOR');
    expect(Object.keys(rep).sort()).toEqual(
      ['band', 'deducted', 'roundsPlayed', 'roundsToAdvance', 'score'].sort(),
    );
  });
});
