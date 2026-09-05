import { SuspensionGate } from '../../src/auth/suspension-gate';

/**
 * The gate that revokes a suspended account's live session.
 *
 * Its whole job is on the hot path — `requireAuth` consults it for every
 * authenticated request — so the caching is not an optimisation detail, it is
 * the reason the feature is affordable. These tests pin the three things that
 * make it safe: it does not read per request, it fails OPEN, and a suspension
 * takes effect immediately in the process that issued it.
 */

/** A clock the test moves by hand. Real time in a TTL test is a flaky test. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: (): number => t, advance: (ms: number): void => void (t += ms) };
}

describe('SuspensionGate', () => {
  it('reports a suspended account', async () => {
    const gate = new SuspensionGate({
      lookup: async () => ({ suspendedAt: new Date('2026-08-28T00:00:00Z') }),
    });
    expect(await gate.isSuspended('p1')).toBe(true);
  });

  it('reports an active account', async () => {
    const gate = new SuspensionGate({ lookup: async () => ({ suspendedAt: null }) });
    expect(await gate.isSuspended('p1')).toBe(false);
  });

  it('treats a player with no identity document as not suspendable', async () => {
    // Every Telegram player. They have no user row at all, and a missing row
    // must not read as suspended — that would lock out the entire Mini App.
    const gate = new SuspensionGate({ lookup: async () => null });
    expect(await gate.isSuspended('tg-1')).toBe(false);
  });

  it('does not hit the lookup again inside the TTL', async () => {
    const lookup = jest.fn(async () => ({ suspendedAt: null }));
    const clock = fakeClock();
    const gate = new SuspensionGate({ lookup, ttlMs: 15_000, now: clock.now });

    await gate.isSuspended('p1');
    await gate.isSuspended('p1');
    await gate.isSuspended('p1');

    // One read per player per TTL, not one per request. Without this the check
    // is a database round trip on every authenticated call in the platform.
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('reads through again once the TTL expires', async () => {
    const lookup = jest.fn(async () => ({ suspendedAt: null }));
    const clock = fakeClock();
    const gate = new SuspensionGate({ lookup, ttlMs: 15_000, now: clock.now });

    await gate.isSuspended('p1');
    clock.advance(15_001);
    await gate.isSuspended('p1');

    // The TTL is the staleness bound for OTHER processes — a suspension issued
    // on one instance must reach the rest. If this never re-read, it never would.
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('picks up a suspension that happens after a cached "active" answer', async () => {
    let suspended = false;
    const clock = fakeClock();
    const gate = new SuspensionGate({
      lookup: async () => ({ suspendedAt: suspended ? new Date() : null }),
      ttlMs: 15_000,
      now: clock.now,
    });

    expect(await gate.isSuspended('p1')).toBe(false);
    suspended = true;
    // Still cached — this is the documented staleness, not a bug.
    expect(await gate.isSuspended('p1')).toBe(false);
    clock.advance(15_001);
    expect(await gate.isSuspended('p1')).toBe(true);
  });

  it('primes without a lookup, so a suspension bites on the next request', async () => {
    const lookup = jest.fn(async () => ({ suspendedAt: null }));
    const gate = new SuspensionGate({ lookup });

    gate.prime('p1', true);

    expect(await gate.isSuspended('p1')).toBe(true);
    // The point of priming: the admin route already KNOWS the answer, so the
    // player is locked out immediately rather than after a TTL.
    expect(lookup).not.toHaveBeenCalled();
  });

  it('primes a reinstatement too', async () => {
    const gate = new SuspensionGate({ lookup: async () => ({ suspendedAt: new Date() }) });
    gate.prime('p1', true);
    expect(await gate.isSuspended('p1')).toBe(true);

    gate.prime('p1', false);
    // Lifting a ban has to be as immediate as issuing one. A reinstated player
    // left locked out for a TTL will simply report the app as broken.
    expect(await gate.isSuspended('p1')).toBe(false);
  });

  it('FAILS OPEN when the lookup throws', async () => {
    // The uncomfortable but correct choice. A database blip must not sign out
    // every player on the platform — that turns an outage into a mass ban, and
    // a mass ban into a support incident far larger than the one suspended
    // account this would have caught.
    const gate = new SuspensionGate({
      lookup: async () => {
        throw new Error('mongo is down');
      },
    });
    expect(await gate.isSuspended('p1')).toBe(false);
  });

  it('does not cache a failure as an answer', async () => {
    // A thrown lookup must not poison the cache with "not suspended" for a
    // whole TTL — the next request should try again.
    const lookup = jest
      .fn<Promise<{ suspendedAt: Date | null } | null>, [string]>()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce({ suspendedAt: new Date() });
    const gate = new SuspensionGate({ lookup });

    expect(await gate.isSuspended('p1')).toBe(false);
    expect(await gate.isSuspended('p1')).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('gives up on a lookup that HANGS, rather than stalling the request', async () => {
    // The failure that matters most, and the one a try/catch does nothing for.
    // Mongoose buffers an operation while the connection is down and waits
    // rather than rejecting, so without a clock a database outage would park
    // every authenticated request on the platform behind this check. It was
    // found by the suite hanging — the same shape a real outage produces.
    const gate = new SuspensionGate({
      lookup: () => new Promise(() => {}), // never settles
      timeoutMs: 20,
    });

    const started = Date.now();
    expect(await gate.isSuspended('p1')).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('does not cache a timeout as an answer', async () => {
    let hang = true;
    const gate = new SuspensionGate({
      lookup: () =>
        hang
          ? new Promise(() => {})
          : Promise.resolve({ suspendedAt: new Date() }),
      timeoutMs: 20,
    });

    expect(await gate.isSuspended('p1')).toBe(false);
    hang = false;
    // A slow database for one request must not grant a whole TTL of access.
    expect(await gate.isSuspended('p1')).toBe(true);
  });

  it('keeps players separate', async () => {
    const gate = new SuspensionGate({
      lookup: async (id: string) => ({ suspendedAt: id === 'banned' ? new Date() : null }),
    });
    expect(await gate.isSuspended('banned')).toBe(true);
    expect(await gate.isSuspended('fine')).toBe(false);
  });
});
