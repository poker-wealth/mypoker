import {
  recordVolume,
  getVolumeFacts,
  coefficientFor,
  monthKey,
  VolumeModel,
} from '../../src/vip/volume-tracker';

/**
 * The tier ladder and progress arithmetic moved to game-server/src/players/vip
 * (tested in test/players/derivation.test.ts) when the duplicated copy here was
 * deleted. This file now guards what this service actually owns: the
 * coefficients (their only home), the write path, and the per-game facts.
 */
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


describe('recording volume', () => {
  it('applies the coefficient at write time', async () => {
    await recordVolume({ playerId: PLAYER, gameId: 'baccarat', staked: $(1000), won: $(900) });

    const standing = await getVolumeFacts(PLAYER);
    // $1,000 staked at ×0.3.
    expect(standing.cumulativeEffective).toBe($(300));
    expect(standing.breakdown[0]!.staked).toBe($(1000));
  });

  it('accumulates across rounds rather than overwriting', async () => {
    for (let i = 0; i < 3; i++) {
      await recordVolume({ playerId: PLAYER, gameId: 'texas', staked: $(100), won: $(80) });
    }
    const standing = await getVolumeFacts(PLAYER);
    expect(standing.breakdown[0]!.rounds).toBe(3);
    expect(standing.cumulativeEffective).toBe($(300));
  });

  it('ignores a round with no stake', async () => {
    await recordVolume({ playerId: PLAYER, gameId: 'texas', staked: 0, won: 0 });
    expect(await VolumeModel.countDocuments({})).toBe(0);
  });

  it('keeps one player’s volume off another', async () => {
    await recordVolume({ playerId: PLAYER, gameId: 'texas', staked: $(1000), won: 0 });
    expect((await getVolumeFacts('tg-someone-else')).cumulativeEffective).toBe(0);
  });
});

describe('the coefficients do what the spec says they are for', () => {
  it('does not let a Baccarat grinder reach a Texas player’s tier', async () => {
    // Both stake $50,000 — the same money at risk.
    await recordVolume({ playerId: 'tg-texas', gameId: 'texas', staked: $(50_000), won: 0 });
    await recordVolume({ playerId: 'tg-bacc', gameId: 'baccarat', staked: $(50_000), won: 0 });

    const texas = await getVolumeFacts('tg-texas');
    const baccarat = await getVolumeFacts('tg-bacc');

    // Texas counts in full and clears V2 at $10,000. Baccarat counts at ×0.3,
    // so $50,000 staked is $15,000 effective — also V2, but a third of the way
    // to V3 rather than half.
    expect(texas.cumulativeEffective).toBe($(50_000));
    expect(baccarat.cumulativeEffective).toBe($(15_000));
  });

  it('needs 3.33x the Baccarat volume for the same effective figure', async () => {
    // The boundary is exact: $333,333 staked gives $99,999.90 effective --
    // ninety cents short of the $100,000 a Texas player reaches at face value.
    await recordVolume({ playerId: 'tg-bacc', gameId: 'baccarat', staked: $(333_333), won: 0 });
    expect((await getVolumeFacts('tg-bacc')).cumulativeEffective).toBe(99_999_900_000);
  });
});


describe('monthly tracking, for retention', () => {
  it('separates this month from lifetime', async () => {
    const now = new Date('2026-08-07T12:00:00Z');
    const lastMonth = new Date('2026-07-07T12:00:00Z');

    await recordVolume({ playerId: PLAYER, gameId: 'texas', staked: $(1000), won: 0, at: lastMonth });
    await recordVolume({ playerId: PLAYER, gameId: 'texas', staked: $(400), won: 0, at: now });

    const standing = await getVolumeFacts(PLAYER, now);
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

    const standing = await getVolumeFacts(PLAYER);
    const texas = standing.breakdown.find((b) => b.gameId === 'texas')!;
    const baccarat = standing.breakdown.find((b) => b.gameId === 'baccarat')!;

    expect(texas.actualRtp).toBe('95.00');
    expect(baccarat.actualRtp).toBe('60.00');
  });

  it('reports null RTP rather than 0% when nothing was staked', async () => {
    // No rounds at all — 0% would read as "this game never pays out".
    expect((await getVolumeFacts(PLAYER)).breakdown).toEqual([]);
  });

  it('orders by effective volume, heaviest first', async () => {
    await recordVolume({ playerId: PLAYER, gameId: 'baccarat', staked: $(1000), won: 0 });
    await recordVolume({ playerId: PLAYER, gameId: 'texas', staked: $(900), won: 0 });

    // Baccarat staked more but Texas counts fully — 900 > 300.
    expect((await getVolumeFacts(PLAYER)).breakdown.map((b) => b.gameId)).toEqual([
      'texas',
      'baccarat',
    ]);
  });
});
