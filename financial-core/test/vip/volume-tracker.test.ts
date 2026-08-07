import {
  recordVolume,
  getVipStanding,
  tierFor,
  coefficientFor,
  monthKey,
  VolumeModel,
  TIERS,
} from '../../src/vip/volume-tracker';
import { startTestDb, stopTestDb, clearCollections } from '../db-helper';

/**
 * The coefficients are the point of this module. The spec says they exist to
 * prevent "gaming with low-rake games" — so the test that matters is that a
 * Baccarat grinder does NOT reach a tier a Texas player would have earned for
 * the same money staked.
 */

const PLAYER = 'tg-vip-test';
const $ = (dollars: number): number => Math.round(dollars * 1_000_000);

beforeAll(startTestDb);
afterAll(stopTestDb);
afterEach(clearCollections);

describe('coefficients', () => {
  it('matches the spec table', () => {
    expect(coefficientFor('texas')).toBe(1.0);
    expect(coefficientFor('baccarat')).toBe(0.3);
    expect(coefficientFor('niu-niu')).toBe(0.5);
  });

  it('falls back to 0.4 for anything unlisted', () => {
    expect(coefficientFor('lottery')).toBe(0.4);
    expect(coefficientFor('a-game-invented-tomorrow')).toBe(0.4);
  });
});

describe('tier thresholds', () => {
  it('matches the spec table exactly', () => {
    expect(tierFor(0).tier).toBe('V1');
    expect(tierFor($(9_999)).tier).toBe('V1');
    expect(tierFor($(10_000)).tier).toBe('V2');
    expect(tierFor($(99_999)).tier).toBe('V2');
    expect(tierFor($(100_000)).tier).toBe('V3');
    expect(tierFor($(499_999)).tier).toBe('V3');
    expect(tierFor($(500_000)).tier).toBe('V4');
    expect(tierFor($(1_999_999)).tier).toBe('V4');
    expect(tierFor($(2_000_000)).tier).toBe('V5');
  });

  it('carries the titles from the spec', () => {
    expect(TIERS.map((t) => t.title)).toEqual([
      'Wanderer',
      'Rising Star',
      'Gold',
      'Platinum',
      'Black Gold',
    ]);
  });
});

describe('recording volume', () => {
  it('applies the coefficient at write time', async () => {
    await recordVolume({ playerId: PLAYER, gameId: 'baccarat', staked: $(1000), won: $(900) });

    const standing = await getVipStanding(PLAYER);
    // $1,000 staked at ×0.3.
    expect(standing.cumulativeEffective).toBe($(300));
    expect(standing.breakdown[0]!.staked).toBe($(1000));
  });

  it('accumulates across rounds rather than overwriting', async () => {
    for (let i = 0; i < 3; i++) {
      await recordVolume({ playerId: PLAYER, gameId: 'texas', staked: $(100), won: $(80) });
    }
    const standing = await getVipStanding(PLAYER);
    expect(standing.breakdown[0]!.rounds).toBe(3);
    expect(standing.cumulativeEffective).toBe($(300));
  });

  it('ignores a round with no stake', async () => {
    await recordVolume({ playerId: PLAYER, gameId: 'texas', staked: 0, won: 0 });
    expect(await VolumeModel.countDocuments({})).toBe(0);
  });

  it('keeps one player’s volume off another', async () => {
    await recordVolume({ playerId: PLAYER, gameId: 'texas', staked: $(1000), won: 0 });
    expect((await getVipStanding('tg-someone-else')).cumulativeEffective).toBe(0);
  });
});

describe('the coefficients do what the spec says they are for', () => {
  it('does not let a Baccarat grinder reach a Texas player’s tier', async () => {
    // Both stake $50,000 — the same money at risk.
    await recordVolume({ playerId: 'tg-texas', gameId: 'texas', staked: $(50_000), won: 0 });
    await recordVolume({ playerId: 'tg-bacc', gameId: 'baccarat', staked: $(50_000), won: 0 });

    const texas = await getVipStanding('tg-texas');
    const baccarat = await getVipStanding('tg-bacc');

    // Texas counts in full and clears V2 at $10,000. Baccarat counts at ×0.3,
    // so $50,000 staked is $15,000 effective — also V2, but a third of the way
    // to V3 rather than half.
    expect(texas.cumulativeEffective).toBe($(50_000));
    expect(baccarat.cumulativeEffective).toBe($(15_000));
    expect(texas.progressPct).toBeGreaterThan(baccarat.progressPct);
  });

  it('needs 3.33× the Baccarat volume to reach a Texas tier', async () => {
    // $100,000 of Texas buys V3. In Baccarat that costs $333,334 staked —
    // and the boundary is exact: $333,333 gives $99,999.90 effective, ninety
    // cents short, and stays V2.
    await recordVolume({ playerId: 'tg-short', gameId: 'baccarat', staked: $(333_333), won: 0 });
    expect((await getVipStanding('tg-short')).tier).toBe('V2');

    await recordVolume({ playerId: 'tg-bacc', gameId: 'baccarat', staked: $(333_334), won: 0 });
    expect((await getVipStanding('tg-bacc')).tier).toBe('V3');
  });
});

describe('progress to the next tier', () => {
  it('measures between thresholds, not from zero', async () => {
    // $300,000 effective: V3 ($100k) heading to V4 ($500k) — half way.
    await recordVolume({ playerId: PLAYER, gameId: 'texas', staked: $(300_000), won: 0 });

    const standing = await getVipStanding(PLAYER);
    expect(standing.tier).toBe('V3');
    expect(standing.next!.tier).toBe('V4');
    expect(standing.next!.remaining).toBe($(200_000));
    // Measured from zero this would read 60% and a V4 would show 25% while
    // being most of the way to V5.
    expect(standing.progressPct).toBe(50);
  });

  it('reports no next tier at V5', async () => {
    await recordVolume({ playerId: PLAYER, gameId: 'texas', staked: $(2_000_000), won: 0 });
    const standing = await getVipStanding(PLAYER);

    expect(standing.tier).toBe('V5');
    expect(standing.next).toBeNull();
    expect(standing.progressPct).toBe(100);
  });

  it('starts a new player at V1 with V2 ahead', async () => {
    const standing = await getVipStanding(PLAYER);
    expect(standing.tier).toBe('V1');
    expect(standing.next!.tier).toBe('V2');
    expect(standing.next!.remaining).toBe($(10_000));
  });
});

describe('monthly tracking, for retention', () => {
  it('separates this month from lifetime', async () => {
    const now = new Date('2026-08-07T12:00:00Z');
    const lastMonth = new Date('2026-07-07T12:00:00Z');

    await recordVolume({ playerId: PLAYER, gameId: 'texas', staked: $(1000), won: 0, at: lastMonth });
    await recordVolume({ playerId: PLAYER, gameId: 'texas', staked: $(400), won: 0, at: now });

    const standing = await getVipStanding(PLAYER, now);
    // Cumulative is permanent and never resets; monthly is the retention gate.
    expect(standing.cumulativeEffective).toBe($(1400));
    expect(standing.monthlyEffective).toBe($(400));
  });

  it('keys months in UTC', () => {
    expect(monthKey(new Date('2026-08-07T23:59:59Z'))).toBe('2026-08');
    expect(monthKey(new Date('2026-09-01T00:00:00Z'))).toBe('2026-09');
  });
});

describe('per-game breakdown', () => {
  it('gives actual RTP per game, which the ledger alone could not', async () => {
    await recordVolume({ playerId: PLAYER, gameId: 'texas', staked: $(1000), won: $(950) });
    await recordVolume({ playerId: PLAYER, gameId: 'baccarat', staked: $(1000), won: $(600) });

    const standing = await getVipStanding(PLAYER);
    const texas = standing.breakdown.find((b) => b.gameId === 'texas')!;
    const baccarat = standing.breakdown.find((b) => b.gameId === 'baccarat')!;

    expect(texas.actualRtp).toBe('95.00');
    expect(baccarat.actualRtp).toBe('60.00');
  });

  it('reports null RTP rather than 0% when nothing was staked', async () => {
    // No rounds at all — 0% would read as "this game never pays out".
    expect((await getVipStanding(PLAYER)).breakdown).toEqual([]);
  });

  it('orders by effective volume, heaviest first', async () => {
    await recordVolume({ playerId: PLAYER, gameId: 'baccarat', staked: $(1000), won: 0 });
    await recordVolume({ playerId: PLAYER, gameId: 'texas', staked: $(900), won: 0 });

    // Baccarat staked more but Texas counts fully — 900 > 300.
    expect((await getVipStanding(PLAYER)).breakdown.map((b) => b.gameId)).toEqual([
      'texas',
      'baccarat',
    ]);
  });
});
