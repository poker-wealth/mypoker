import express from 'express';
import request from 'supertest';
import { buildMeRouter } from '../../src/gateway/me-routes';
import { loadConfig } from '../../src/gateway/config';
import { signToken } from '../../src/gateway/tokens';
import { overrideStore } from '../../src/players/override-store';

/**
 * What `/me/vip` returns for an OVERRIDDEN player.
 *
 * Two bugs shipped here in one afternoon, and the second was worse than the
 * first:
 *
 *   1. `tier` was overridden and `title` was not, so a player granted V5 saw
 *      the V5 badge beside "Wanderer" — V1's name.
 *   2. The fix set `next: null` and `progressPct: 100`. The client reads
 *      `next === null` as "you are at the top tier", so a player granted V2 was
 *      told they had reached the top of the ladder.
 *
 * The test written after the first bug asserted `vipSpec` directly — a pure
 * function that was never wrong — so it passed while the route was broken both
 * times. This one goes through the ROUTE, which is where both bugs lived.
 */
jest.mock('../../src/players/override-store', () => ({
  overrideStore: { get: jest.fn(), set: jest.fn(), clearCache: jest.fn(), cacheSize: jest.fn() },
}));

const JWT_SECRET = 'test-secret-me-vip';
const PLAYER = 'player-1';

const config = loadConfig({
  JWT_SECRET,
  NODE_ENV: 'test',
  FINANCIAL_CORE_URL: 'http://fc.test',
} as NodeJS.ProcessEnv);

/** financial-core's volume facts, stubbed at the fetch boundary. */
function volumeIs(cumulativeEffective: number): void {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ cumulativeEffective, monthlyEffective: 0 }),
  })) as unknown as typeof fetch;
}

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/me', buildMeRouter(config));
  return a;
};

const getVip = () =>
  request(app())
    .get('/me/vip')
    .set('authorization', `Bearer ${signToken({ playerId: PLAYER, role: 'player' }, JWT_SECRET, 300)}`);

beforeEach(() => {
  jest.clearAllMocks();
  volumeIs(0);
  (overrideStore.get as jest.Mock).mockResolvedValue(null);
});

describe('GET /me/vip with an override', () => {
  it('returns the granted tier AND its own title', async () => {
    // Bug 1. A player with zero volume computes to V1/Wanderer.
    (overrideStore.get as jest.Mock).mockResolvedValue({
      reputationScore: null,
      vipTier: 'V5',
      setBy: 'admin-1',
      reason: 'partner',
      at: 'now',
    });

    const res = await getVip();

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('V5');
    expect(res.body.title).toBe('Black Gold');
    expect(res.body.title).not.toBe('Wanderer');
  });

  it('does NOT claim a mid-ladder override is the top tier', async () => {
    // Bug 2, and the reason this file exists. `next === null` is how the client
    // renders "you are at the top tier" — a V2 must not trigger it.
    (overrideStore.get as jest.Mock).mockResolvedValue({
      reputationScore: null,
      vipTier: 'V2',
      setBy: 'admin-1',
      reason: 'goodwill',
      at: 'now',
    });

    const res = await getVip();

    expect(res.body.tier).toBe('V2');
    expect(res.body.next).not.toBeNull();
    expect(res.body.next.tier).toBe('V3');
    // The real gap to V3, from real volume — honest either way.
    expect(res.body.next.remaining).toBeGreaterThan(0);
  });

  it('still reports the top tier as the top tier', async () => {
    // The other half: fixing bug 2 must not make V5 claim there is more above.
    (overrideStore.get as jest.Mock).mockResolvedValue({
      reputationScore: null,
      vipTier: 'V5',
      setBy: 'admin-1',
      reason: 'partner',
      at: 'now',
    });

    const res = await getVip();
    expect(res.body.next).toBeNull();
  });

  it('leaves real volume untouched', async () => {
    volumeIs(12_345);
    (overrideStore.get as jest.Mock).mockResolvedValue({
      reputationScore: null,
      vipTier: 'V5',
      setBy: 'admin-1',
      reason: 'x',
      at: 'now',
    });

    const res = await getVip();

    // The granted tier is a decision; the volume is what they actually played.
    expect(res.body.cumulativeEffective).toBe(12_345);
    expect(res.body.overridden).toBe(true);
    expect(res.body.computedTier).toBe('V1');
  });

  it('is unchanged for a player with no override', async () => {
    const res = await getVip();

    expect(res.body.tier).toBe('V1');
    expect(res.body.title).toBe('Wanderer');
    expect(res.body.overridden).toBeUndefined();
    expect(res.body.next).not.toBeNull();
  });

  it('ignores an override naming a tier the ladder does not define', async () => {
    // Stored as a plain string; `vipSpec` indexes the ladder by position and
    // would throw on a value like 'V9' rather than ignoring it.
    (overrideStore.get as jest.Mock).mockResolvedValue({
      reputationScore: null,
      vipTier: 'V9',
      setBy: 'admin-1',
      reason: 'x',
      at: 'now',
    });

    const res = await getVip();

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('V1');
  });
});
