import express from 'express';
import request from 'supertest';
import { buildAgentRouter } from '../../src/gateway/agent-routes';
import { loadConfig } from '../../src/gateway/config';
import { signToken } from '../../src/gateway/tokens';
import { overrideStore } from '../../src/players/override-store';

/**
 * The agency eligibility GATE, with an administrator's override in play.
 *
 * This is the bug the review found, at the level it actually lives. There are
 * unit tests for `effectiveReputation` beside this, and they are not enough:
 * they prove the rule computes the right number, not that the ROUTE asks it.
 * The original defect was exactly that gap — `scoreFor(...)` was called and the
 * override was never fetched, so every pure test of the rule would have stayed
 * green while an administrator's decision was ignored at the one place it was
 * supposed to bite (docs/TRAPS.md §1: prefer one exercise of the seam over ten
 * unit tests either side of it).
 */
jest.mock('../../src/players/override-store', () => ({
  overrideStore: { get: jest.fn(), getMany: jest.fn(), set: jest.fn(), clearCache: jest.fn() },
}));

const JWT_SECRET = 'test-secret-agent-eligibility';
const PLAYER = 'player-1';

const config = loadConfig({
  JWT_SECRET,
  NODE_ENV: 'test',
  FINANCIAL_CORE_URL: 'http://fc.test',
} as NodeJS.ProcessEnv);

/**
 * financial-core's eligibility facts, stubbed at the fetch boundary.
 *
 * 900 rounds with no findings computes comfortably above the 700 bar — so any
 * refusal below comes from the override and nothing else.
 */
function factsAre(opts: { roundsPlayed: number; findings?: string[]; alreadyAgent?: boolean }): void {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      roundsPlayed: opts.roundsPlayed,
      findings: opts.findings ?? [],
      alreadyAgent: opts.alreadyAgent ?? false,
    }),
  })) as unknown as typeof fetch;
}

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/agent', buildAgentRouter(config));
  return a;
};

const getEligibility = () =>
  request(app())
    .get('/agent/eligibility')
    .set('authorization', `Bearer ${signToken({ playerId: PLAYER, role: 'player' }, JWT_SECRET, 300)}`);

const override = (patch: Record<string, unknown>) => ({
  reputationScore: null,
  vipTier: null,
  setBy: 'admin-1',
  reason: 'test',
  at: 'now',
  ...patch,
});

beforeEach(() => {
  jest.clearAllMocks();
  factsAre({ roundsPlayed: 900 });
  (overrideStore.get as jest.Mock).mockResolvedValue(null);
});

describe('GET /agent/eligibility with an override', () => {
  it('is eligible on good facts and no override — the baseline', async () => {
    const res = await getEligibility();
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(true);
    expect(res.body.reasons).toEqual([]);
  });

  it('REFUSES when an administrator overrode the score below the bar', async () => {
    // The shipped bug. The facts alone clear 700, so before this the gate said
    // "eligible" while the player's own profile showed the overridden 120 —
    // an administrator pulling someone's standing watched them become an agent
    // anyway.
    (overrideStore.get as jest.Mock).mockResolvedValue(override({ reputationScore: 120 }));

    const res = await getEligibility();

    expect(res.body.eligible).toBe(false);
    expect(res.body.reasons).toContain('reputation_below_700');
    // And it REPORTS the effective number, so the screen cannot disagree with
    // the decision it is acting on.
    expect(res.body.reputation).toBe(120);
  });

  it('ALLOWS when an override raises a failing score above the bar', async () => {
    // Both directions, because an override is a decision either way. A gate
    // that only honoured demotions would be a different inconsistency.
    factsAre({ roundsPlayed: 1 });
    const raised = await getEligibility();
    expect(raised.body.eligible).toBe(false);

    (overrideStore.get as jest.Mock).mockResolvedValue(override({ reputationScore: 900 }));
    const res = await getEligibility();

    expect(res.body.eligible).toBe(true);
    expect(res.body.reputation).toBe(900);
  });

  it('still refuses a confirmed colluder who was granted a high score', async () => {
    // The safety property. The collusion and bot checks read the FINDINGS, not
    // the score, so no number an administrator types can turn a confirmed
    // colluder into an agent. If this ever goes green-to-red, the override has
    // been wired somewhere it must not reach.
    factsAre({ roundsPlayed: 900, findings: ['COLLUSION_CONFIRMED'] });
    (overrideStore.get as jest.Mock).mockResolvedValue(override({ reputationScore: 1000 }));

    const res = await getEligibility();

    expect(res.body.eligible).toBe(false);
    expect(res.body.reasons).toContain('confirmed_collusion');
  });

  it('is unchanged when the override row sets only a VIP tier', async () => {
    // An override may grant a tier and say nothing about reputation. The row's
    // existence is not the decision — the field is.
    (overrideStore.get as jest.Mock).mockResolvedValue(override({ vipTier: 'V4' }));

    const res = await getEligibility();

    expect(res.body.eligible).toBe(true);
  });
});
