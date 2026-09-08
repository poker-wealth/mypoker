import { SuspensionGate } from '../../src/auth/suspension-gate';

/**
 * The gate's OTHER half: revoking a DEMOTED admin's live session.
 *
 * `requireAdmin` used to trust the `ops` claim baked into a JWT with nothing
 * re-checking it, so demoting an administrator wrote the database and left
 * their existing session with full admin authority — the withdrawal queue,
 * every player record, the power to mint more admins — until the token
 * expired, up to `jwtTtlSeconds` (a day by default).
 *
 * `isOps` shares the exact cache/TTL/timeout/prime machinery `isSuspended`
 * already had — see `suspension-gate.test.ts` for the base mechanics (TTL
 * expiry, per-player isolation, the hang-vs-timeout distinction). These tests
 * are about what is DIFFERENT: the failure direction, and the fact that
 * priming one fact must never fabricate the other.
 */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: (): number => t, advance: (ms: number): void => void (t += ms) };
}

describe('SuspensionGate.isOps', () => {
  it('reports a current administrator', async () => {
    const gate = new SuspensionGate({ lookup: async () => ({ suspendedAt: null, role: 'ops' }) });
    expect(await gate.isOps('p1', true)).toBe(true);
  });

  it('reports a demoted (or never-admin) account', async () => {
    const gate = new SuspensionGate({ lookup: async () => ({ suspendedAt: null, role: 'player' }) });
    expect(await gate.isOps('p1', true)).toBe(false);
  });

  it('treats a player with no identity document as not ops', async () => {
    // Every Telegram player — no document, so no role field to be ops on.
    const gate = new SuspensionGate({ lookup: async () => null });
    expect(await gate.isOps('tg-1', true)).toBe(false);
  });

  it('does not hit the lookup again inside the TTL', async () => {
    const lookup = jest.fn(async () => ({ suspendedAt: null, role: 'ops' as const }));
    const clock = fakeClock();
    const gate = new SuspensionGate({ lookup, ttlMs: 15_000, now: clock.now });

    await gate.isOps('p1', true);
    await gate.isOps('p1', true);
    await gate.isOps('p1', true);

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('FALLS BACK TO THE CALLER-SUPPLIED TOKEN CLAIM on a lookup error — not a fixed answer', async () => {
    // The uncomfortable-but-correct choice, and the opposite direction from
    // `isSuspended`'s fail-open. Failing open here (always true) would grant
    // admin access on a fact the gate could not verify; failing closed
    // (always false) would lock out every administrator on a database blip.
    // Falling back to what the token already claims is what `requireAdmin`
    // did with NO check at all before this existed — an outage degrades to
    // the pre-existing behaviour instead of a new failure in either
    // direction. Asserted with BOTH fallback values so this cannot be a
    // hardcoded `true` in disguise.
    const gate = new SuspensionGate({
      lookup: async () => {
        throw new Error('mongo is down');
      },
    });
    expect(await gate.isOps('p1', true)).toBe(true);
    expect(await gate.isOps('p1', false)).toBe(false);
  });

  it('falls back to the token claim on a lookup that HANGS, rather than stalling the request', async () => {
    const gate = new SuspensionGate({
      lookup: () => new Promise(() => {}), // never settles
      timeoutMs: 20,
    });
    const started = Date.now();
    expect(await gate.isOps('p1', true)).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('does not cache a failure as an answer', async () => {
    const lookup = jest
      .fn<Promise<{ suspendedAt: Date | null; role?: 'player' | 'ops' } | null>, [string]>()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce({ suspendedAt: null, role: 'ops' });
    const gate = new SuspensionGate({ lookup });

    expect(await gate.isOps('p1', false)).toBe(false); // the fallback, not a cached lie
    expect(await gate.isOps('p1', false)).toBe(true); // the real read-through
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('primes a demotion without a lookup, so it bites on the very next request', async () => {
    const lookup = jest.fn(async () => ({ suspendedAt: null, role: 'ops' as const }));
    const gate = new SuspensionGate({ lookup });

    gate.primeRole('p1', false);

    expect(await gate.isOps('p1', true)).toBe(false);
    // The point of priming: the admin route already KNOWS the new role, so
    // the demotion is effective immediately rather than after a TTL.
    expect(lookup).not.toHaveBeenCalled();
  });

  it('primes a promotion too', async () => {
    const gate = new SuspensionGate({ lookup: async () => ({ suspendedAt: null, role: 'player' }) });
    gate.primeRole('p1', false);
    expect(await gate.isOps('p1', true)).toBe(false);

    gate.primeRole('p1', true);
    expect(await gate.isOps('p1', false)).toBe(true);
  });

  it('priming a role does NOT fabricate a suspension answer for the same player', async () => {
    // `prime` and `primeRole` each know only ONE fact. `primeRole` must not
    // invent "not suspended" for an account it was never told anything about
    // on that axis — the demotion route has no idea whether this player is
    // also suspended, and guessing "no" would be exactly the kind of
    // fabricated fact this codebase keeps getting burned by.
    const lookup = jest.fn(async () => ({ suspendedAt: new Date(), role: 'player' as const }));
    const gate = new SuspensionGate({ lookup });

    gate.primeRole('p1', false);
    expect(await gate.isSuspended('p1')).toBe(true); // read through, not guessed
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('priming a suspension does NOT fabricate a role answer for the same player', async () => {
    const lookup = jest.fn(async () => ({ suspendedAt: null, role: 'ops' as const }));
    const gate = new SuspensionGate({ lookup });

    gate.prime('p1', false);
    expect(await gate.isOps('p1', false)).toBe(true); // read through, not guessed
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('a genuine lookup for one fact refreshes both, from the one query', async () => {
    // The efficiency case: `requireAuth` (suspension) and `requireAdmin`
    // (role) run back to back on the same request, and this is what keeps
    // that at one database read instead of two.
    const lookup = jest.fn(async () => ({ suspendedAt: null, role: 'ops' as const }));
    const gate = new SuspensionGate({ lookup });

    expect(await gate.isSuspended('p1')).toBe(false);
    expect(await gate.isOps('p1', false)).toBe(true);

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('keeps players separate', async () => {
    const gate = new SuspensionGate({
      lookup: async (id: string) => ({ suspendedAt: null, role: id === 'admin' ? 'ops' : 'player' }),
    });
    expect(await gate.isOps('admin', false)).toBe(true);
    expect(await gate.isOps('someone-else', false)).toBe(false);
  });
});
