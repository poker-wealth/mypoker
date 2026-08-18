import { currentRuleManifest, ruleVersionFor, type GameRules } from '../../src/fairness/rule-version';

/**
 * The rule-version stamp (queue #12).
 *
 * A published payout rate is only worth anything if the rules behind it were
 * fixed in advance and can be named. That makes two properties load-bearing:
 *
 *   DETERMINISM — the same rules must always hash the same, or every boot would
 *   look like a rule change and the signal would be worthless.
 *
 *   SENSITIVITY — any change that moves money must change the hash, or the stamp
 *   would vouch for rules that are no longer the ones in force. That is worse
 *   than having no stamp: it is a false guarantee.
 */

const base: GameRules = {
  gameId: 'texas',
  rakeBps: 500,
  jackpotBps: 50,
  paytable: { rakeCap: 600, noFlopNoDrop: 1 },
};

describe('rule version — determinism', () => {
  it('hashes the same rules to the same version, every time', () => {
    expect(ruleVersionFor(base)).toBe(ruleVersionFor({ ...base }));
  });

  it('does not depend on key order', () => {
    // Object literals in a different declaration order are the SAME rules. If
    // the hash moved, a harmless refactor would announce itself as a rule change.
    const reordered: GameRules = {
      paytable: { noFlopNoDrop: 1, rakeCap: 600 },
      jackpotBps: 50,
      rakeBps: 500,
      gameId: 'texas',
    };
    expect(ruleVersionFor(reordered)).toBe(ruleVersionFor(base));
  });

  it('is stable across calls to the full manifest', () => {
    expect(currentRuleManifest().version).toBe(currentRuleManifest().version);
  });
});

describe('rule version — sensitivity to anything that moves money', () => {
  it.each([
    ['rake', { ...base, rakeBps: 501 }],
    ['jackpot injection', { ...base, jackpotBps: 51 }],
    ['rake cap', { ...base, paytable: { ...base.paytable, rakeCap: 601 } }],
    ['no-flop-no-drop', { ...base, paytable: { ...base.paytable, noFlopNoDrop: 0 } }],
    ['a new paytable entry', { ...base, paytable: { ...base.paytable, tiePayout: 8 } }],
  ])('changes when %s changes', (_what, changed) => {
    expect(ruleVersionFor(changed as GameRules)).not.toBe(ruleVersionFor(base));
  });

  it('gives different games different versions even on identical numbers', () => {
    // Otherwise one game's published rate would appear to vouch for another's.
    expect(ruleVersionFor({ ...base, gameId: 'omaha' })).not.toBe(ruleVersionFor(base));
  });
});

describe('the manifest describes every game', () => {
  it('covers the whole catalogue, sorted so the hash is order-independent', () => {
    const m = currentRuleManifest();
    const ids = m.games.map((g) => g.gameId);
    expect(ids).toEqual([...ids].sort());
    expect(ids.length).toBeGreaterThanOrEqual(11);
  });

  it('states a rake and a jackpot rate for each', () => {
    for (const g of currentRuleManifest().games) {
      expect(Number.isInteger(g.rakeBps)).toBe(true);
      expect(Number.isInteger(g.jackpotBps)).toBe(true);
      // Basis points: a rate above 100% would be a typo that silently takes
      // everything, so bound it rather than trust the constant.
      expect(g.rakeBps).toBeGreaterThanOrEqual(0);
      expect(g.rakeBps).toBeLessThanOrEqual(10_000);
    }
  });

  it('is a 64-character hex digest', () => {
    expect(currentRuleManifest().version).toMatch(/^[0-9a-f]{64}$/);
  });
});
