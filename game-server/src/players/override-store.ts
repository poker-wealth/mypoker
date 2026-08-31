import type { ClientSession } from 'mongoose';
import { PlayerOverrideModel, type PlayerOverrideDoc } from './override.model';

/**
 * Reading and writing administrator overrides.
 *
 * Cached the same way the suspension gate is, and for the same reason: the
 * player's own reputation and VIP screens read this on every request, and a
 * database round trip per view for a value that changes perhaps twice in an
 * account's lifetime is a poor trade. The admin routes prime the cache when
 * they write, so an override is visible immediately.
 */

export interface PlayerOverride {
  reputationScore: number | null;
  vipTier: string | null;
  setBy: string;
  reason: string;
  at: string;
}

const TTL_MS = 30_000;

/**
 * How many players' answers are held at once.
 *
 * A CAP, because the cache is otherwise unbounded: it gains an entry for every
 * distinct player ever viewed and never drops one, since expiry only refreshes
 * an entry rather than removing it. On a platform with a large player base that
 * is a slow leak for the life of the process.
 *
 * The eviction below is deliberately crude — oldest-inserted first, not
 * least-recently-used. An LRU would need a touch on every read and is not worth
 * it here: almost every entry is `null` (no override exists for most players),
 * so a miss costs one indexed lookup by primary key.
 */
const MAX_ENTRIES = 5_000;

const cache = new Map<string, { value: PlayerOverride | null; at: number }>();

/**
 * Drop expired entries, and if still over the cap, the oldest.
 *
 * Map preserves insertion order, so the first keys are the oldest inserted.
 */
function evict(now: number): void {
  for (const [key, entry] of cache) {
    if (now - entry.at >= TTL_MS) cache.delete(key);
  }
  if (cache.size <= MAX_ENTRIES) return;
  const excess = cache.size - MAX_ENTRIES;
  let dropped = 0;
  for (const key of cache.keys()) {
    if (dropped >= excess) break;
    cache.delete(key);
    dropped += 1;
  }
}

const toOverride = (d: PlayerOverrideDoc): PlayerOverride => ({
  reputationScore: d.reputationScore ?? null,
  vipTier: d.vipTier ?? null,
  setBy: d.setBy,
  reason: d.reason,
  at: d.updatedAt.toISOString(),
});

export const overrideStore = {
  /**
   * The override for one player, or null.
   *
   * Fails OPEN — a lookup error returns null, meaning "no override", so the
   * player sees their genuinely computed value. The alternative on an outage is
   * a screen that cannot render at all, and the computed figure is never wrong,
   * only sometimes not what an administrator decided to show instead.
   */
  async get(playerId: string): Promise<PlayerOverride | null> {
    const hit = cache.get(playerId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    try {
      const doc = await PlayerOverrideModel.findById(playerId).lean();
      const value = doc ? toOverride(doc as PlayerOverrideDoc) : null;
      const now = Date.now();
      cache.set(playerId, { value, at: now });
      if (cache.size > MAX_ENTRIES) evict(now);
      return value;
    } catch {
      // Not cached — a lookup blip must not fix "no override" for a whole TTL.
      return null;
    }
  },

  /**
   * Overrides for many players in ONE query.
   *
   * For the list surfaces — the agent player list, the admin withdrawal queue —
   * which render a tier per row. Calling `get` per row would be a query per
   * player on a page that already has the whole page in hand.
   *
   * Players with no override are simply absent from the map, so a caller reads
   * `map.get(id) ?? null` and gets the same shape `get` returns.
   *
   * Fails OPEN like `get`, and for the same reason: on a lookup error every
   * player renders their genuinely computed figure rather than the page failing
   * to render at all. Note the consequence honestly — during an outage an
   * administrator's decision is not reflected on these lists. That is the right
   * trade for a DISPLAY surface, and it is why the eligibility GATE, which
   * makes a decision rather than showing one, is worth treating differently if
   * this ever becomes load-bearing there.
   */
  async getMany(playerIds: readonly string[]): Promise<Map<string, PlayerOverride>> {
    const ids = [...new Set(playerIds)];
    if (ids.length === 0) return new Map();

    const out = new Map<string, PlayerOverride>();
    const now = Date.now();
    const missing: string[] = [];
    for (const id of ids) {
      const hit = cache.get(id);
      if (hit && now - hit.at < TTL_MS) {
        if (hit.value) out.set(id, hit.value);
      } else {
        missing.push(id);
      }
    }
    if (missing.length === 0) return out;

    try {
      const docs = await PlayerOverrideModel.find({ _id: { $in: missing } }).lean();
      const found = new Map(
        docs.map((d) => [String((d as PlayerOverrideDoc)._id), toOverride(d as PlayerOverrideDoc)]),
      );
      const at = Date.now();
      for (const id of missing) {
        const value = found.get(id) ?? null;
        // A miss is cached as null too — otherwise a page of players with no
        // overrides re-queries every one of them on every render.
        cache.set(id, { value, at });
        if (value) out.set(id, value);
      }
      if (cache.size > MAX_ENTRIES) evict(at);
    } catch {
      // Nothing cached on failure, same as `get`.
    }
    return out;
  },

  /**
   * Set or clear. `null` on a field clears THAT field; clearing both removes
   * the document entirely, so an account with no override has no row rather
   * than a row full of nulls that reads like a decision someone made.
   */
  async set(
    playerId: string,
    patch: { reputationScore?: number | null; vipTier?: string | null },
    setBy: string,
    reason: string,
    session?: ClientSession,
  ): Promise<{ before: PlayerOverride | null; after: PlayerOverride | null }> {
    // Every query here takes the session, or the write lands outside the
    // transaction it is supposed to be atomic with — silently, and only in the
    // failure case the transaction exists for.
    const existing = await PlayerOverrideModel.findById(playerId).session(session ?? null).lean();
    const before = existing ? toOverride(existing as PlayerOverrideDoc) : null;

    const nextRep =
      patch.reputationScore === undefined ? before?.reputationScore ?? null : patch.reputationScore;
    const nextVip = patch.vipTier === undefined ? before?.vipTier ?? null : patch.vipTier;

    if (nextRep === null && nextVip === null) {
      await PlayerOverrideModel.deleteOne({ _id: playerId }, session ? { session } : {});
      cache.set(playerId, { value: null, at: Date.now() });
      return { before, after: null };
    }

    const doc = await PlayerOverrideModel.findOneAndUpdate(
      { _id: playerId },
      {
        $set: {
          ...(nextRep === null ? {} : { reputationScore: nextRep }),
          ...(nextVip === null ? {} : { vipTier: nextVip }),
          setBy,
          reason,
        },
        ...(nextRep === null || nextVip === null
          ? {
              $unset: {
                ...(nextRep === null ? { reputationScore: '' } : {}),
                ...(nextVip === null ? { vipTier: '' } : {}),
              },
            }
          : {}),
      },
      { new: true, upsert: true, ...(session ? { session } : {}) },
    ).lean();

    const after = doc ? toOverride(doc as PlayerOverrideDoc) : null;
    cache.set(playerId, { value: after, at: Date.now() });
    return { before, after };
  },

  /** Test seam — the cache is process-wide and would otherwise leak between tests. */
  clearCache(): void {
    cache.clear();
  },

  /** Test seam — so a test can assert the cap actually bounds the map. */
  cacheSize(): number {
    return cache.size;
  },
};
