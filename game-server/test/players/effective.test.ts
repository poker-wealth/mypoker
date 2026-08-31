import { effectiveReputation, effectiveVipTier, isVipTier } from '../../src/players/effective';
import type { PlayerOverride } from '../../src/players/override-store';

/**
 * The single derivation point for an administrator's override.
 *
 * There were four of these and they disagreed. `/me/reputation` and the admin
 * detail view applied the override; the AGENCY ELIGIBILITY GATE did not, so an
 * administrator could override someone down to pull their agency and watch them
 * become an agent anyway — the decision showed on the profile and was ignored by
 * the gate meant to act on it. The agent player list and the admin withdrawal
 * queue showed raw tiers beside a detail view showing overridden ones.
 *
 * These are pure functions precisely so this can be tested without a database
 * (the same reason `isClaimableBySignup` was pulled out of the user store), and
 * so the list surfaces can fetch once for a whole page.
 */

const override = (patch: Partial<PlayerOverride>): PlayerOverride => ({
  reputationScore: null,
  vipTier: null,
  setBy: 'admin-1',
  reason: 'test',
  at: 'now',
  ...patch,
});

describe('effectiveReputation', () => {
  it('uses the computed score when there is no override at all', () => {
    const r = effectiveReputation(742, null);
    expect(r.score).toBe(742);
    expect(r.overridden).toBe(false);
    expect(r.computedScore).toBe(742);
  });

  it('uses the computed score when the row exists but sets no reputation', () => {
    // An override may grant a VIP tier and say nothing about reputation. The
    // row's EXISTENCE is not the decision — the field is.
    const r = effectiveReputation(742, override({ vipTier: 'V3' }));
    expect(r.score).toBe(742);
    expect(r.overridden).toBe(false);
  });

  it('applies an override that LOWERS the score — the agency case', () => {
    // The bug, stated as a test. 742 clears the 700 agency bar; 120 does not.
    // The gate read the computed figure, so an administrator pulling someone's
    // standing watched them become an agent regardless.
    const r = effectiveReputation(742, override({ reputationScore: 120 }));
    expect(r.score).toBe(120);
    expect(r.overridden).toBe(true);
    // The facts underneath are never rewritten — both numbers stay available,
    // because they are different claims: a history and a decision.
    expect(r.computedScore).toBe(742);
  });

  it('applies an override that RAISES the score', () => {
    const r = effectiveReputation(120, override({ reputationScore: 900 }));
    expect(r.score).toBe(900);
    expect(r.overridden).toBe(true);
  });

  it('honours a genuine zero rather than reading it as absent', () => {
    // `?? ` semantics matter here: 0 is a real score an administrator can set,
    // and `||` or a truthiness check would silently restore the computed one.
    const r = effectiveReputation(742, override({ reputationScore: 0 }));
    expect(r.score).toBe(0);
    expect(r.overridden).toBe(true);
  });

  it('derives the band from the EFFECTIVE score, not the computed one', () => {
    // A band computed from the raw score beside an overridden number is the
    // same disagreement one field over.
    const low = effectiveReputation(900, override({ reputationScore: 100 }));
    const high = effectiveReputation(100, override({ reputationScore: 900 }));
    expect(low.band).not.toEqual(high.band);
    expect(low.band).toEqual(effectiveReputation(100, null).band);
  });
});

describe('effectiveVipTier', () => {
  it('returns the computed tier when there is no override', () => {
    const v = effectiveVipTier('V1', null);
    expect(v.tier).toBe('V1');
    expect(v.title).toBe('Wanderer');
    expect(v.overridden).toBe(false);
  });

  it('gives a granted tier its OWN title', () => {
    // The shipped bug: a player granted V5 saw the V5 badge beside "Wanderer",
    // V1's name, because the tier was overridden and the title was not.
    const v = effectiveVipTier('V1', override({ vipTier: 'V5' }));
    expect(v.tier).toBe('V5');
    expect(v.title).toBe('Black Gold');
    expect(v.title).not.toBe('Wanderer');
    expect(v.overridden).toBe(true);
  });

  it('keeps the computed tier alongside, so a grant is distinguishable', () => {
    const v = effectiveVipTier('V1', override({ vipTier: 'V4' }));
    expect(v.computedTier).toBe('V1');
  });

  it('ignores a tier the ladder does not define', () => {
    // Stored as a plain string. `vipSpec` indexes the ladder by position, so a
    // retired or bogus value must read as "no override" rather than throw and
    // take the whole response down.
    const v = effectiveVipTier('V2', override({ vipTier: 'V9' }));
    expect(v.tier).toBe('V2');
    expect(v.overridden).toBe(false);
  });

  it('ignores a non-string tier', () => {
    const v = effectiveVipTier('V2', override({ vipTier: 3 as unknown as string }));
    expect(v.tier).toBe('V2');
    expect(v.overridden).toBe(false);
  });
});

describe('isVipTier', () => {
  it('accepts every tier the ladder defines', () => {
    for (const t of ['V1', 'V2', 'V3', 'V4', 'V5']) expect(isVipTier(t)).toBe(true);
  });

  it('rejects anything else', () => {
    for (const v of ['V0', 'V6', 'V9', '', 'v1', null, undefined, 3, {}]) {
      expect(isVipTier(v)).toBe(false);
    }
  });
});
