import * as fs from 'node:fs';
import * as path from 'node:path';
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
import { startTestDb, stopTestDb, clearCollections } from '../db-helper';

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

  it('mints a link of UUID + 32-char salt', async () => {
    const link = await createReferralLink(AGENT_A);
    // 36 chars of UUID plus 32 of hex salt.
    expect(link).toHaveLength(68);
    expect(link.slice(36)).toMatch(/^[0-9a-f]{32}$/);
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
