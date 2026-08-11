import * as fs from 'node:fs';
import * as path from 'node:path';
import { Decimal128 } from 'bson';
import {
  getReputationFacts,
  recordFinding,
  ReputationFindingModel,
} from '../../src/reputation/player-reputation';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { AccountModel } from '../../src/wallet/account.model';
import { getOrCreatePlayerAccount } from '../../src/wallet/system-accounts';
import { LedgerType, LedgerDirection } from '../../src/domain/account-types';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * financial-core stores reputation FACTS; the scoring rules live in
 * game-server/src/players/reputation.ts and are tested there
 * (test/players/derivation.test.ts). What this file guards is the storage —
 * and the iron rule, which survives the refactor in an even stronger form:
 * there is no longer a score in this service for a withdrawal to branch on.
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

describe('facts', () => {
  it('reports rounds from the ledger and no findings for a clean account', async () => {
    await playRounds(7);
    const facts = await getReputationFacts(PLAYER);
    expect(facts).toEqual({ roundsPlayed: 7, findings: [] });
  });

  it('returns findings oldest first', async () => {
    await recordFinding({ playerId: PLAYER, reason: 'CHALLENGE_FAIL', confirmedBy: 'ops', findingId: 'f1' });
    await recordFinding({ playerId: PLAYER, reason: 'BOT_CONFIRMED', confirmedBy: 'ops', findingId: 'f2' });

    const facts = await getReputationFacts(PLAYER);
    expect(facts.findings).toEqual(['CHALLENGE_FAIL', 'BOT_CONFIRMED']);
  });

  it('will not record the same finding twice', async () => {
    await recordFinding({ playerId: PLAYER, reason: 'BOT_CONFIRMED', confirmedBy: 'ops', findingId: 'same' });
    await recordFinding({ playerId: PLAYER, reason: 'BOT_CONFIRMED', confirmedBy: 'ops', findingId: 'same' });

    expect(await ReputationFindingModel.countDocuments({ playerId: PLAYER })).toBe(1);
  });

  it('keeps one player’s findings off another', async () => {
    await recordFinding({ playerId: PLAYER, reason: 'COLLUSION_CONFIRMED', confirmedBy: 'ops', findingId: 'f1' });
    expect((await getReputationFacts('p-someone-else')).findings).toEqual([]);
  });
});

describe('IRON RULE: reputation never blocks funds', () => {
  it('is not imported by any withdrawal or balance module', () => {

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

  it('holds no score at all — only history', async () => {
    await recordFinding({ playerId: PLAYER, reason: 'COLLUSION_CONFIRMED', confirmedBy: 'ops', findingId: 'f1' });
    const facts = await getReputationFacts(PLAYER);

    // Post-refactor the strongest possible form of the rule: this service has
    // nothing a withdrawal COULD branch on, not even a number.
    expect(Object.keys(facts).sort()).toEqual(['findings', 'roundsPlayed']);
  });
});
