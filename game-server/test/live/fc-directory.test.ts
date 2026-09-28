import { FcPlayerDirectory } from '../../src/live/fc-directory';

/**
 * A fake `fetch` for the one endpoint FcPlayerDirectory calls: GET .../accounts/:id/balance.
 * Records the query string it was called with and answers with a caller-supplied USDT figure.
 */
function fakeFetch(balanceOf: (qs: string) => string): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetch = (async (url: string | URL): Promise<Response> => {
    const u = new URL(String(url));
    calls.push(u.search);
    return {
      ok: true,
      json: async () => ({ available: balanceOf(u.search) }),
    } as Response;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('FcPlayerDirectory — cache scope (D2 follow-up)', () => {
  it('a LEAGUE-scoped read does not overwrite the cached (PLATFORM) balance', async () => {
    const { fetch, calls } = fakeFetch((qs) => (qs.includes('LEAGUE') ? '5.00' : '100.00'));
    const directory = new FcPlayerDirectory({ baseUrl: 'http://fc.test', internalSecret: 's', fetchImpl: fetch });

    // Seed the cache directly with a known PLATFORM balance — sit()'s pre-check reads exactly this
    // field, so what matters here is whether availableChips(..., LEAGUE) is allowed to clobber it.
    (directory as unknown as { cache: Map<string, { available: number; displayName: string; reputationScore: number }> })
      .cache.set('alice', { available: 10_000, displayName: 'Alice', reputationScore: 1000 });

    const leagueRead = await directory.availableChips('alice', { tableType: 'LEAGUE', leagueId: 'league-7' });

    expect(leagueRead).toBe(500); // 5.00 USDT -> 500 chips: the fresh, correctly-scoped answer
    expect(calls[0]).toContain('tableType=LEAGUE');
    // The cache — the PLATFORM figure sit()'s pre-check relies on — must be untouched.
    expect(directory.find('alice')!.available).toBe(10_000);
  });

  it('an unscoped (PLATFORM) read still updates the cache as before', async () => {
    const { fetch } = fakeFetch(() => '25.00');
    const directory = new FcPlayerDirectory({ baseUrl: 'http://fc.test', internalSecret: 's', fetchImpl: fetch });
    (directory as unknown as { cache: Map<string, { available: number; displayName: string; reputationScore: number }> })
      .cache.set('bob', { available: 0, displayName: 'Bob', reputationScore: 1000 });

    const read = await directory.availableChips('bob');

    expect(read).toBe(2_500);
    expect(directory.find('bob')!.available).toBe(2_500);
  });
});
