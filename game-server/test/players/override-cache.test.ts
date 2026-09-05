import { overrideStore } from '../../src/players/override-store';
import { PlayerOverrideModel } from '../../src/players/override.model';

/**
 * The override cache must not grow without bound.
 *
 * It gains an entry for every distinct player ever looked up, and expiry only
 * REFRESHES an entry rather than removing it — so without a cap the map grows
 * for the life of the process, one slot per player who has ever been viewed.
 * Not exploitable, but a leak that gets worse exactly as the platform succeeds.
 *
 * No database: `findById` is stubbed. The cap is a property of the cache, not
 * of Mongo, and a real connection here would test the driver instead.
 */
jest.mock('../../src/players/override.model', () => ({
  PlayerOverrideModel: { findById: jest.fn() },
}));

const noDocument = { lean: async (): Promise<null> => null };

beforeEach(() => {
  overrideStore.clearCache();
  (PlayerOverrideModel.findById as jest.Mock).mockReturnValue(noDocument);
});

describe('override cache', () => {
  it('stays bounded as distinct players are looked up', async () => {
    // Comfortably past the 5,000 cap. If eviction never ran, this would be
    // 6,000 entries held forever.
    for (let i = 0; i < 6_000; i += 1) {
      await overrideStore.get(`player-${i}`);
    }

    expect(overrideStore.cacheSize()).toBeLessThanOrEqual(5_000);
  });

  it('still answers correctly for a player after eviction has run', async () => {
    for (let i = 0; i < 6_000; i += 1) {
      await overrideStore.get(`player-${i}`);
    }

    // The cap must bound memory without breaking correctness — an evicted
    // player is simply re-read, which is the whole point of it being a cache.
    (PlayerOverrideModel.findById as jest.Mock).mockReturnValue({
      lean: async () => ({
        _id: 'player-0',
        reputationScore: 900,
        setBy: 'admin-1',
        reason: 'test',
        updatedAt: new Date('2026-08-28T00:00:00Z'),
      }),
    });

    const value = await overrideStore.get('player-0');
    expect(value?.reputationScore).toBe(900);
  });

  it('serves a repeat lookup from cache rather than reading again', async () => {
    // The property the cap must not break: the cache still caches.
    await overrideStore.get('player-a');
    await overrideStore.get('player-a');
    await overrideStore.get('player-a');

    expect(PlayerOverrideModel.findById).toHaveBeenCalledTimes(1);
  });

  it('does not cache a lookup failure', async () => {
    (PlayerOverrideModel.findById as jest.Mock).mockReturnValue({
      lean: async (): Promise<never> => {
        throw new Error('mongo is down');
      },
    });

    expect(await overrideStore.get('player-b')).toBeNull();

    // A blip must not fix "no override" for a whole TTL — the next read tries
    // again, and a player with a granted tier gets it back.
    (PlayerOverrideModel.findById as jest.Mock).mockReturnValue({
      lean: async () => ({
        _id: 'player-b',
        vipTier: 'V4',
        setBy: 'admin-1',
        reason: 'partner',
        updatedAt: new Date('2026-08-28T00:00:00Z'),
      }),
    });
    expect((await overrideStore.get('player-b'))?.vipTier).toBe('V4');
  });
});
