import { tierOf } from './reputation';
import { vipSpec, VIP_TIERS, type VipTier } from './vip';
import type { PlayerOverride } from './override-store';

/**
 * What a player's reputation and VIP tier ACTUALLY are, once an administrator's
 * override is taken into account.
 *
 * One derivation point, because there were four and they disagreed.
 * `/me/reputation` and the admin detail view applied the override; the AGENCY
 * ELIGIBILITY GATE did not, so an administrator could override someone down to
 * pull their agency and watch them become an agent anyway — the override read
 * one way on the profile and the opposite at the gate that was supposed to act
 * on it. The agent player list and the admin withdrawal queue showed raw tiers
 * beside a detail view showing overridden ones.
 *
 * That is iron rule #4 in reverse: a second copy of a rule eventually gives a
 * second answer. Here it gave four.
 *
 * These functions are PURE — the override is passed in, never fetched. That is
 * deliberate: it makes the rule testable without a database (the same reason
 * `isClaimableBySignup` was pulled out of the user store), and it lets the bulk
 * callers fetch once for many players instead of once per row.
 *
 * An override is a DECISION, not a fact. The facts underneath — rounds played,
 * findings, volume — are never rewritten, so a player granted a score of 90
 * still sees the rounds they really played. The two do not have to agree; they
 * are different claims.
 */

export interface EffectiveReputation {
  /** The score to act on and display. */
  score: number;
  /** The band for `score` — derived here so no caller re-derives it from the raw one. */
  band: ReturnType<typeof tierOf>;
  /** What the facts alone would have produced. */
  computedScore: number;
  /** True when an administrator replaced the score. */
  overridden: boolean;
}

/**
 * `override` is the stored row, or null. `null` and a row with a null
 * `reputationScore` mean the same thing here — no decision was made about the
 * score — which is why this reads the field rather than the row's existence:
 * an override may set a VIP tier and leave reputation alone.
 */
export function effectiveReputation(
  computedScore: number,
  override: PlayerOverride | null,
): EffectiveReputation {
  const overridden = override?.reputationScore != null;
  const score = overridden ? override!.reputationScore! : computedScore;
  return { score, band: tierOf(score), computedScore, overridden };
}

export interface EffectiveVip {
  tier: VipTier;
  /** ALWAYS derived from `tier`, never carried over from the computed one. */
  title: string;
  computedTier: VipTier;
  overridden: boolean;
}

/**
 * The title is recomputed from the resolved tier on purpose.
 *
 * The first version of the override set the tier and left the title alone, so a
 * player granted V5 saw the V5 badge beside the word "Wanderer" — V1's name.
 * Deriving both from one value here is what stops that returning at a fifth
 * call site.
 */
export function effectiveVipTier(
  computedTier: VipTier,
  override: PlayerOverride | null,
): EffectiveVip {
  const overridden = isVipTier(override?.vipTier);
  const tier = overridden ? (override!.vipTier as VipTier) : computedTier;
  return { tier, title: vipSpec(tier).title, computedTier, overridden };
}

/**
 * Is this a tier the ladder actually defines?
 *
 * A type guard rather than a cast: an override arrives from a request body, and
 * a tier of `'V9'` would sail through a cast and then throw inside `vipSpec`,
 * which indexes the ladder by position. A stored value from a retired ladder
 * has to read as "no override" rather than take the whole response down.
 *
 * THE one copy. This existed identically in `admin-routes.ts` and
 * `me-routes.ts`; both now import it from here. Two private copies of a guard
 * that decides whether an administrator's decision is honoured is the same
 * class of problem as the four derivation points above, one level down.
 */
export function isVipTier(value: unknown): value is VipTier {
  return typeof value === 'string' && VIP_TIERS.some((t) => t.tier === value);
}
