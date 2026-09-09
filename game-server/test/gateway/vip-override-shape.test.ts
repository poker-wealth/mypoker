import { vipSpec, VIP_TIERS, vipProgress } from '../../src/players/vip';

/**
 * The VIP LADDER: that each tier has its own title and privileges.
 *
 * READ THE NAME OF THIS FILE SCEPTICALLY. It was written after a route bug —
 * an override set `tier` and left `title` computed, so a player granted V5 saw
 * the V5 badge beside "Wanderer" — and it does NOT cover that route. It
 * exercises `vipSpec` and `vipProgress`, pure functions that were never wrong.
 * Reintroducing the route bug leaves every assertion here green; that was
 * demonstrated, not assumed.
 *
 * The route is covered by `me-vip-override.test.ts`, which goes through
 * `/me/vip` and does go red.
 *
 * Kept because the ladder itself is worth pinning — a tier whose title or
 * privileges drift is a real bug — but kept under an honest description of
 * what it can catch.
 */
describe('an overridden tier and its title', () => {
  it.each(VIP_TIERS.map((t) => [t.tier, t.title]))(
    '%s resolves to the title %s',
    (tier, title) => {
      expect(vipSpec(tier as never).title).toBe(title);
    },
  );

  it('never lets a granted tier keep the computed tier’s name', () => {
    // The exact failure: a player with no volume computes to V1/Wanderer, and
    // an override to V5 must change BOTH halves, not just the identifier.
    const computed = vipProgress(0);
    expect(computed.tier).toBe('V1');
    expect(computed.title).toBe('Wanderer');

    const granted = vipSpec('V5');
    expect(granted.tier).toBe('V5');
    expect(granted.title).not.toBe(computed.title);
    expect(granted.title).toBe('Black Gold');
  });

  it('gives every tier a distinct title, so the pairing is worth asserting', () => {
    // If two tiers shared a title the test above could pass while the bug was
    // still present for the pair that matched.
    const titles = VIP_TIERS.map((t) => t.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('carries the privileges of the granted tier, not the computed one', () => {
    // The reason the title cannot simply be stored beside the tier: a name and
    // a set of privileges that disagree is worse than either being wrong.
    const v1 = vipSpec('V1');
    const v5 = vipSpec('V5');
    expect(v1.instantAutoTransfer).toBe(false);
    expect(v5.instantAutoTransfer).toBe(true);
    expect(v5.withdrawalPriority).toBeGreaterThan(v1.withdrawalPriority);
  });
});
