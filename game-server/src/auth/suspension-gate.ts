/**
 * Revoking a suspended account's LIVE session — and a demoted admin's.
 *
 * Suspension used to block sign-in and nothing else, so a player already signed
 * in kept their session — games included — until the token expired, up to
 * twenty-four hours. For the case suspension exists to handle, that is the
 * window that matters: someone suspended for cheating stays at the table.
 *
 * The `ops` role has the identical shape of problem, and a worse blast radius:
 * `requireAdmin` used to trust the `ops` claim baked into the JWT with nothing
 * re-checking it, so demoting an administrator (`PATCH /admin/players/:id`)
 * left them holding full admin authority — the withdrawal queue, every player
 * record, the ability to mint more admins — until their token expired.
 *
 * The obvious implementation is a database read on every authenticated request,
 * and that is a real cost on a hot path — `requireAuth` runs on everything. So:
 *
 *   - answers are CACHED for a few seconds, which bounds the read rate per
 *     player rather than per request;
 *   - the admin routes that suspend or demote someone PRIME the cache
 *     directly, so in the process that served the write it takes effect on the
 *     very next request, with no waiting for a TTL;
 *   - the TTL is what carries the change to any OTHER process. It is the
 *     staleness bound in a multi-instance deployment, and it is deliberately
 *     short.
 *
 * ONE lookup, ONE cache entry per player, for both facts — not a second gate
 * next to this one. `userStore.suspensionOf` selects both fields in a single
 * narrow projection, so a request that needs both (`requireAuth` then
 * `requireAdmin`, back to back) costs one database read, not two.
 *
 * The two facts fail in OPPOSITE directions on a lookup error, and that
 * asymmetry is the whole reason they cannot share one fallback policy despite
 * sharing everything else. See `isSuspended` and `isOps` for why.
 */

/** Just the lookup this needs — so tests do not need Mongo, and neither does the rule. */
export interface SuspensionLookup {
  (playerId: string): Promise<{ suspendedAt: Date | null; role?: 'player' | 'ops' } | null>;
}

export interface SuspensionGateOptions {
  lookup: SuspensionLookup;
  /** How long an answer is reused. Short: it is the cross-process staleness bound. */
  ttlMs?: number;
  /**
   * How long to wait for the lookup before giving up and letting the request
   * through. See `LOOKUP_TIMEOUT_MS`.
   */
  timeoutMs?: number;
  now?: () => number;
}

/**
 * `suspended` and `ops` are timestamped SEPARATELY, not together, even though
 * one lookup fills in both at once. The reason is `prime`/`primeRole`: each is
 * called with only ONE fact in hand (the suspension route knows the new
 * suspension state; the role-patch route knows the new role), and it must
 * never invent a value for the fact it was NOT told. A shared timestamp would
 * force that invention — priming one field would either reset the other to a
 * guess or dishonestly extend its freshness. A field with no confirmed
 * timestamp (`0`, always stale) simply reads through on next use instead of
 * being guessed at.
 */
interface Entry {
  suspended: boolean;
  suspendedCheckedAt: number;
  ops: boolean;
  opsCheckedAt: number;
}

export const DEFAULT_TTL_MS = 15_000;

/**
 * How long the lookup gets before the request is let through anyway.
 *
 * A TIMEOUT AND NOT ONLY A TRY/CATCH, because the dangerous failure is not a
 * throw — it is a hang. Mongoose BUFFERS an operation when the connection is
 * down and waits (ten seconds by default) rather than rejecting, so a database
 * outage would have parked every authenticated request on the platform behind
 * a suspension check. Catching errors does nothing for that; only a clock does.
 *
 * Found by the test suite hanging, which is the same failure a real outage
 * would produce, arriving early and for free.
 */
export const LOOKUP_TIMEOUT_MS = 500;

/**
 * How many players' answers are held at once.
 *
 * The cache gains an entry for every distinct playerId that ever authenticates
 * and, without this, never drops one — expiry only refreshes an entry rather
 * than removing it. A review named this gate and the override store as twins
 * on the same defect; the override store was capped and this one was not, which
 * is the mirror-rule mistake the same review was convened to find.
 */
export const MAX_ENTRIES = 10_000;

export class SuspensionGate {
  private readonly cache = new Map<string, Entry>();
  private readonly lookup: SuspensionLookup;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(options: SuspensionGateOptions) {
    this.lookup = options.lookup;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? LOOKUP_TIMEOUT_MS;
    this.now = options.now ?? ((): number => Date.now());
  }

  /**
   * Is this account suspended right now?
   *
   * A player with no identity document — every Telegram player — is not
   * suspendable and is cached as such, so the common case costs one lookup per
   * TTL rather than one per request.
   *
   * FAILS OPEN on a lookup error or timeout: see the class comment. A database
   * blip must not read as a mass ban.
   */
  async isSuspended(playerId: string): Promise<boolean> {
    const hit = this.cache.get(playerId);
    if (hit && this.now() - hit.suspendedCheckedAt < this.ttlMs) return hit.suspended;

    try {
      const user = await this.withTimeout(this.lookup(playerId));
      this.store(playerId, user);
      return Boolean(user?.suspendedAt);
    } catch {
      // See the class comment: a lookup failure must not sign out the
      // platform. Not cached either — a blip should not fix an answer for a
      // whole TTL.
      return false;
    }
  }

  /**
   * Is this account CURRENTLY `ops`, per the STORED role — not the claim a
   * token happened to carry when it was signed, up to `jwtTtlSeconds` ago?
   *
   * `fallbackToTokenClaim` is the answer to fall back on if the lookup fails
   * or times out. It is deliberately NOT a fixed `true` or `false` baked into
   * this method, and it is deliberately NOT the same failure mode as
   * `isSuspended`:
   *
   *   - Failing open (always `true`) would mean "we could not verify this
   *     account is still an administrator, so we granted admin access
   *     anyway" — the withdrawal queue, every player record, the power to
   *     mint more admins, handed out on a fact the gate could not confirm.
   *     That is the wrong direction for a privilege check, unlike suspension
   *     where the safe default is to let an ordinary session continue.
   *   - Failing closed (always `false`) would mean a database blip locks out
   *     every administrator on the platform simultaneously, at the exact
   *     moment (a database problem) an administrator is most likely to be
   *     needed.
   *
   * Falling back to the token's own claim is what `requireAdmin` did with NO
   * check at all before this existed, so an outage degrades this control back
   * to its pre-existing behaviour rather than introducing a new failure mode
   * in either direction. `requireAdmin` only ever calls this after the token
   * has already claimed `ops`, so in practice the fallback is always "let the
   * already-verified claim stand" — never "invent a claim nobody made".
   */
  async isOps(playerId: string, fallbackToTokenClaim: boolean): Promise<boolean> {
    const hit = this.cache.get(playerId);
    if (hit && this.now() - hit.opsCheckedAt < this.ttlMs) return hit.ops;

    try {
      const user = await this.withTimeout(this.lookup(playerId));
      this.store(playerId, user);
      return user?.role === 'ops';
    } catch {
      return fallbackToTokenClaim;
    }
  }

  /** Write both fields from one genuine lookup — real truth, never a guess. */
  private store(playerId: string, user: { suspendedAt: Date | null; role?: 'player' | 'ops' } | null): void {
    const checkedAt = this.now();
    this.cache.set(playerId, {
      suspended: Boolean(user?.suspendedAt),
      suspendedCheckedAt: checkedAt,
      ops: user?.role === 'ops',
      opsCheckedAt: checkedAt,
    });
    if (this.cache.size > MAX_ENTRIES) this.evict(checkedAt);
  }

  /**
   * Drop fully-expired entries, then the oldest if still over the cap.
   *
   * "Fully expired" means BOTH facts are stale — an entry whose role was primed
   * a moment ago still carries a fresh answer even if its suspension timestamp
   * is old, and dropping it would throw away truth to save a slot.
   *
   * Map preserves insertion order, so the first keys are the oldest inserted.
   * Oldest-first rather than least-recently-used: an LRU needs a write on every
   * read, on the hottest path in the gateway, to bound a map that is only a
   * cache. A wrongly-evicted entry costs one indexed lookup.
   */
  private evict(now: number): void {
    for (const [key, entry] of this.cache) {
      const stale =
        now - entry.suspendedCheckedAt >= this.ttlMs && now - entry.opsCheckedAt >= this.ttlMs;
      if (stale) this.cache.delete(key);
    }
    if (this.cache.size <= MAX_ENTRIES) return;
    let excess = this.cache.size - MAX_ENTRIES;
    for (const key of this.cache.keys()) {
      if (excess <= 0) break;
      this.cache.delete(key);
      excess -= 1;
    }
  }

  /**
   * Reject if the lookup has not answered in time.
   *
   * The timer is unref'd so a pending check cannot hold the process open at
   * shutdown, and cleared on settle so a slow-but-successful lookup does not
   * leave a timer per request behind it.
   */
  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('suspension lookup timed out')), this.timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Record a suspension state we already know, without a lookup.
   *
   * Called by the admin route the moment it suspends or reinstates someone, so
   * the change is effective on the next request in this process instead of
   * after a TTL. This is what makes revocation feel immediate rather than
   * eventually-correct.
   *
   * Leaves any cached `ops` fact exactly as it was, timestamp included — this
   * call site knows nothing about the account's role and must not overwrite
   * it with a guess. A brand-new entry gets `ops: false` with `opsCheckedAt: 0`,
   * a timestamp that is always stale, so the next role check reads through
   * rather than trusting an invented value.
   */
  prime(playerId: string, suspended: boolean): void {
    const existing = this.cache.get(playerId);
    const at = this.now();
    this.cache.set(playerId, {
      suspended,
      suspendedCheckedAt: at,
      ops: existing?.ops ?? false,
      opsCheckedAt: existing?.opsCheckedAt ?? 0,
    });
    // The cap applies to EVERY way in, not only the read path. This one grows
    // by admin action rather than by traffic, so it leaks far more slowly —
    // but "slowly" is still the unbounded-map defect this cache was capped to
    // fix, and a write path exempt from the rule is how it comes back.
    if (this.cache.size > MAX_ENTRIES) this.evict(at);
  }

  /**
   * Record a role we already know, without a lookup — the `isOps` half of
   * `prime`. Called the moment an admin route WRITES a new role, so a
   * demotion bites on the very next request in this process rather than
   * after a TTL or, worse, after the token itself expires (up to
   * `jwtTtlSeconds`, default a day).
   *
   * Symmetric with `prime`: leaves any cached `suspended` fact untouched
   * rather than guessing it.
   */
  primeRole(playerId: string, ops: boolean): void {
    const existing = this.cache.get(playerId);
    const at = this.now();
    this.cache.set(playerId, {
      suspended: existing?.suspended ?? false,
      suspendedCheckedAt: existing?.suspendedCheckedAt ?? 0,
      ops,
      opsCheckedAt: at,
    });
    if (this.cache.size > MAX_ENTRIES) this.evict(at);
  }

  /** Drop a cached answer, forcing the next check to read through. */
  invalidate(playerId: string): void {
    this.cache.delete(playerId);
  }

  /** Test seam. */
  size(): number {
    return this.cache.size;
  }
}

/**
 * The gate every `requireAuth` (suspension) and `requireAdmin` (role) uses
 * unless one is injected.
 *
 * A SINGLETON WITH A DEFAULT, rather than a parameter threaded through fifteen
 * call sites across six routers. That is not only for brevity: a revocation
 * check that each router has to remember to opt into is one a new router will
 * forget, and the failure is silent — the route works perfectly and simply
 * never enforces the ban. Opt-out is the right default for a security control.
 *
 * The lookup is resolved lazily, at call time, so importing this module does
 * not require a database connection and tests that mock the user store still
 * get the mock.
 */
export const defaultSuspensionGate = new SuspensionGate({
  lookup: async (playerId) => {
    // Imported inside the closure deliberately: at module scope this would be a
    // cycle (user-store does not import this, but the admin routes import both)
    // and would also bind the real store before a test could mock it.
    const { userStore } = await import('./user-store');
    return userStore.suspensionOf(playerId);
  },
});
