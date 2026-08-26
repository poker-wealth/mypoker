import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Decimal128 } from 'bson';
import {
  createAgent,
  createReferralLink,
  linksFor,
  bindReferral,
  referralFor,
  recordCommission,
  playersOf,
  summaryFor,
  subAgentsOf,
  setSubAgentRate,
  AgentError,
  AgentCommissionModel,
  ReferralBindingModel,
} from '../../src/agent/agent-store';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { getOrCreatePlayerAccount } from '../../src/wallet/system-accounts';
import { LedgerType, LedgerDirection } from '../../src/domain/account-types';
import { startTestDb, stopTestDb, clearCollections } from '../db-helper';

/** Give a player `n` settled rounds, the same way player-reputation.test.ts does. */
async function playRounds(playerId: string, n: number): Promise<void> {
  const accountId = (await getOrCreatePlayerAccount(playerId))._id;
  const docs = Array.from({ length: n }, (_, i) => ({
    _id: `${playerId}-r${i}`,
    idempotencyKey: `${playerId}-r${i}`,
    businessId: `${playerId}-round-${i}`,
    accountId,
    counterpartyAccountId: 'house',
    direction: LedgerDirection.DEBIT,
    amount: Decimal128.fromString('1'),
    type: LedgerType.BET,
    createdAt: new Date(),
  }));
  await LedgerModel.insertMany(docs);
}

/**
 * The binding rules and the balance-visibility block are the two that matter.
 *
 * A rebindable player lets two agents claim the same lifetime volume, and the
 * second claim is indistinguishable from the first. And an agent who can see a
 * player's balance is the failure the whole permission model exists to prevent.
 */

const AGENT_A = 'tg-agent-a';
const AGENT_B = 'tg-agent-b';
const PLAYER = 'tg-player-1';

beforeAll(startTestDb);
afterAll(stopTestDb);
afterEach(clearCollections);

describe('agents', () => {
  it('creates a top-level agent with no parent', async () => {
    const agent = await createAgent({ agentId: AGENT_A, rateBps: 3000 });
    expect(agent.parentAgentId).toBeNull();
    expect(agent.rateBps).toBe(3000);
  });

  it('creates a sub-agent under a parent', async () => {
    await createAgent({ agentId: AGENT_A, rateBps: 3000 });
    const sub = await createAgent({ agentId: AGENT_B, rateBps: 1500, parentAgentId: AGENT_A });

    expect(sub.parentAgentId).toBe(AGENT_A);
    expect((await subAgentsOf(AGENT_A)).map((a) => a.agentId)).toEqual([AGENT_B]);
  });

  it('refuses a third level', async () => {
    // Two levels only, per spec. Without the bound the override chain is
    // unbounded and commission stops being computable from a single round.
    await createAgent({ agentId: AGENT_A, rateBps: 3000 });
    await createAgent({ agentId: AGENT_B, rateBps: 1500, parentAgentId: AGENT_A });

    await expect(
      createAgent({ agentId: 'tg-agent-c', rateBps: 500, parentAgentId: AGENT_B }),
    ).rejects.toThrow(/two levels only/);
  });

  it('refuses an unknown parent', async () => {
    await expect(
      createAgent({ agentId: AGENT_B, rateBps: 1500, parentAgentId: 'tg-nobody' }),
    ).rejects.toThrow(/no such parent/);
  });

  it('refuses to enrol the same agent twice', async () => {
    await createAgent({ agentId: AGENT_A, rateBps: 3000 });
    await expect(createAgent({ agentId: AGENT_A, rateBps: 3000 })).rejects.toThrow(/already an agent/);
  });
});

describe('referral links', () => {
  beforeEach(async () => {
    await createAgent({ agentId: AGENT_A, rateBps: 3000 });
  });

  it('mints a link that fits a Telegram deep link', async () => {
    const link = await createReferralLink(AGENT_A);

    // This assertion used to read `toHaveLength(68)` — it described what the
    // generator happened to emit rather than what a referral link has to be,
    // so it passed happily while every link produced was unusable. The real
    // requirement is Telegram's: `?start=` takes 1–64 chars of [A-Za-z0-9_-],
    // and 68 was four too many.
    expect(link.length).toBeLessThanOrEqual(64);
    expect(link).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(link.length).toBeGreaterThanOrEqual(32); // unguessable
  });

  it('mints distinct links every time', async () => {
    const a = await createReferralLink(AGENT_A, 'telegram');
    const b = await createReferralLink(AGENT_A, 'twitter');
    expect(a).not.toBe(b);
  });

  it('counts registrations per link, so channels can be compared', async () => {
    const tg = await createReferralLink(AGENT_A, 'telegram');
    const tw = await createReferralLink(AGENT_A, 'twitter');

    await bindReferral('p1', tg);
    await bindReferral('p2', tg);
    await bindReferral('p3', tw);

    const links = await linksFor(AGENT_A);
    expect(links.find((l) => l.label === 'telegram')!.registrations).toBe(2);
    expect(links.find((l) => l.label === 'twitter')!.registrations).toBe(1);
  });

  it('refuses a link for someone who is not an agent', async () => {
    await expect(createReferralLink('tg-nobody')).rejects.toThrow(/not an agent/);
  });
});

describe('referral bindings — permanent, set once', () => {
  let linkA: string;
  let linkB: string;

  beforeEach(async () => {
    await createAgent({ agentId: AGENT_A, rateBps: 3000 });
    await createAgent({ agentId: AGENT_B, rateBps: 1500, parentAgentId: AGENT_A });
    linkA = await createReferralLink(AGENT_A);
    linkB = await createReferralLink(AGENT_B);
  });

  it('binds a player to the agent whose link they used', async () => {
    await bindReferral(PLAYER, linkA);
    expect(await referralFor(PLAYER)).toEqual({ directAgentId: AGENT_A, parentAgentId: null });
  });

  it('records the parent when the referrer is a sub-agent', async () => {
    await bindReferral(PLAYER, linkB);
    // B gets the direct commission, A the override — so both must be on the row.
    expect(await referralFor(PLAYER)).toEqual({ directAgentId: AGENT_B, parentAgentId: AGENT_A });
  });

  it('never rebinds a player to a second agent', async () => {
    await bindReferral(PLAYER, linkA);
    await bindReferral(PLAYER, linkB);

    // Still A. Rebinding would let two agents claim one player's lifetime volume.
    expect((await referralFor(PLAYER))!.directAgentId).toBe(AGENT_A);
    expect(await ReferralBindingModel.countDocuments({ _id: PLAYER })).toBe(1);
  });

  it('treats a retried signup as a no-op rather than an error', async () => {
    await bindReferral(PLAYER, linkA);
    await expect(bindReferral(PLAYER, linkA)).resolves.toBeUndefined();
  });

  it('refuses an unknown link', async () => {
    await expect(bindReferral(PLAYER, 'not-a-link')).rejects.toThrow(/unknown referral link/);
  });

  it('refuses an agent referring themselves', async () => {
    await expect(bindReferral(AGENT_A, linkA)).rejects.toThrow(/cannot refer themselves/);
  });

  it('leaves an unreferred player with no binding', async () => {
    expect(await referralFor('tg-organic')).toBeNull();
  });

  it('binds a brand-new player — zero rounds played', async () => {
    // No ledger activity at all for PLAYER: playRounds is never called.
    await bindReferral(PLAYER, linkA);
    expect(await referralFor(PLAYER)).toEqual({ directAgentId: AGENT_A, parentAgentId: null });
  });

  it('refuses to bind a player who has already played a hand', async () => {
    // "Agents earn a share of the rake from players they bring in" — a player
    // with rounds on the books was not brought in by this link.
    await playRounds(PLAYER, 1);

    await expect(bindReferral(PLAYER, linkA)).rejects.toThrow(/not eligible for referral attribution/);

    // The rejection must be real: no row written for them anywhere.
    expect(await referralFor(PLAYER)).toBeNull();
    expect(await ReferralBindingModel.countDocuments({ _id: PLAYER })).toBe(0);
  });
});

describe('commission records', () => {
  beforeEach(async () => {
    await createAgent({ agentId: AGENT_A, rateBps: 3000 });
    const link = await createReferralLink(AGENT_A);
    await bindReferral(PLAYER, link);
  });

  it('will not pay an agent twice for one round', async () => {
    const entry = { agentId: AGENT_A, playerId: PLAYER, roundId: 'r-1', amount: 30_000_000, kind: 'DIRECT' as const };
    await recordCommission(entry);
    await recordCommission(entry);

    expect(await AgentCommissionModel.countDocuments({ agentId: AGENT_A })).toBe(1);
    expect((await summaryFor(AGENT_A))!.totalCommission).toBe(30_000_000);
  });

  it('ignores a zero or negative amount', async () => {
    await recordCommission({ agentId: AGENT_A, playerId: PLAYER, roundId: 'r-2', amount: 0, kind: 'DIRECT' });
    expect(await AgentCommissionModel.countDocuments({})).toBe(0);
  });

  it('accumulates across rounds', async () => {
    await recordCommission({ agentId: AGENT_A, playerId: PLAYER, roundId: 'r-1', amount: 10_000_000, kind: 'DIRECT' });
    await recordCommission({ agentId: AGENT_A, playerId: PLAYER, roundId: 'r-2', amount: 5_000_000, kind: 'DIRECT' });

    const summary = await summaryFor(AGENT_A);
    expect(summary!.totalCommission).toBe(15_000_000);
    expect((await playersOf(AGENT_A))[0]!.rounds).toBe(2);
  });
});

describe('IRON RULE: an agent never sees a player balance', () => {
  beforeEach(async () => {
    await createAgent({ agentId: AGENT_A, rateBps: 3000 });
    const link = await createReferralLink(AGENT_A);
    await bindReferral(PLAYER, link);
    await recordCommission({ agentId: AGENT_A, playerId: PLAYER, roundId: 'r-1', amount: 30_000_000, kind: 'DIRECT' });
  });

  it('exposes no balance field on a referred player', async () => {
    const [row] = await playersOf(AGENT_A);

    // The complete set of what an agent may know about someone they referred,
    // and an allowlist rather than a "does not contain balance" check: a new
    // field has to be added here deliberately, which is the moment someone has
    // to justify it.
    //
    // Every entry is §13.4 Tab 2 data — what the player STAKED and what that
    // earned the agent. None of it is what the player HOLDS, and the difference
    // is the rule: volume is the agent's business, balance never is.
    expect(Object.keys(row!).sort()).toEqual(
      [
        'boundAt',
        'commissionGenerated',
        'lastActiveAt',
        'playerId',
        'rounds',
        'linkId', //           which referral link they registered through
        'viaAgentId', //       the sub-agent they sit under, if any
        'todayVolume', //      staked today — NOT held
        'monthVolume', //      staked this month — NOT held
        'todayCommission', //  what the AGENT earned today
        'monthCommission', //  what the AGENT earned this month
        'lifetimeEffective', // cumulative staked volume, for the VIP ladder
      ].sort(),
    );
  });

  it('exposes no balance on the agent summary either', async () => {
    const summary = await summaryFor(AGENT_A);
    expect(Object.keys(summary!).sort()).toEqual(
      [
        'agentId',
        'parentAgentId', // which tier of agent they are, for §13.4's badge
        'playerCount',
        'rateBps',
        'status',
        'subAgentCount',
        'totalCommission',
      ].sort(),
    );
  });

  it('does not import the wallet or balance modules', () => {

    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'agent', 'agent-store.ts'),
      'utf8',
    );

    // No import is the cheapest possible guarantee: a balance cannot leak from
    // a module that has no way to read one.
    expect(source).not.toMatch(/from\s+['"].*(wallet|account\.model|system-accounts)/);
  });
});

describe('setSubAgentRate — B’s rate is set and owned by A (§13.1)', () => {
  const AGENT_B = 'agent-b';
  const OUTSIDER = 'agent-outsider';

  beforeEach(async () => {
    await createAgent({ agentId: AGENT_A, rateBps: 3000 });
    await createAgent({ agentId: OUTSIDER, rateBps: 3000 });
    await createAgent({ agentId: AGENT_B, rateBps: 1000, parentAgentId: AGENT_A });
  });

  it('lets the parent change their own sub-agent’s rate', async () => {
    await setSubAgentRate(AGENT_A, AGENT_B, 2000);
    const [sub] = await subAgentsOf(AGENT_A);
    expect(sub!.rateBps).toBe(2000);
  });

  it('refuses another agent trying to set someone else’s sub-agent', async () => {
    // Not a permission message: an agent asking about a sub-agent that is not
    // theirs should not learn that it exists.
    await expect(setSubAgentRate(OUTSIDER, AGENT_B, 2000)).rejects.toThrow(AgentError);

    const [sub] = await subAgentsOf(AGENT_A);
    expect(sub!.rateBps).toBe(1000);
  });

  it('refuses an unknown sub-agent', async () => {
    await expect(setSubAgentRate(AGENT_A, 'nobody', 2000)).rejects.toThrow(AgentError);
  });
});

/**
 * A referral link is handed to Telegram as a deep-link `start` parameter:
 *
 *     https://t.me/<bot>?start=<linkId>
 *
 * Telegram limits that parameter to 64 characters drawn from [A-Za-z0-9_-].
 * An id that breaks either rule produces a link that simply does not open —
 * and it fails at the moment an agent shares it with someone, which is the
 * furthest possible point from anywhere it would be noticed.
 *
 * The generator produced 68 characters (`randomUUID()` + 16 bytes of hex)
 * until this test existed, so every referral link ever created was unusable.
 */
describe('referral link ids fit a Telegram deep link', () => {
  /** Telegram Bot API: deep-link parameter, 1–64 chars, A-Z a-z 0-9 _ - */
  const TELEGRAM_START_MAX = 64;

  it('creates ids Telegram will accept', async () => {
    const agentId = `agent-${randomUUID()}`;
    await createAgent({ agentId, rateBps: 500 });

    // Several, because the id is random and a length bug can be intermittent
    // when it depends on an encoding whose output length varies.
    for (let i = 0; i < 25; i++) {
      const linkId = await createReferralLink(agentId, `link-${i}`);
      expect(linkId.length).toBeLessThanOrEqual(TELEGRAM_START_MAX);
      expect(linkId).toMatch(/^[A-Za-z0-9_-]+$/);
      // Long enough to be unguessable: a short id is a link anyone can forge
      // their way into someone else's downline with.
      expect(linkId.length).toBeGreaterThanOrEqual(32);
    }
  });

  it('gives every link a distinct id', async () => {
    const agentId = `agent-${randomUUID()}`;
    await createAgent({ agentId, rateBps: 500 });
    const ids = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createReferralLink(agentId, `dup-${i}`)),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
