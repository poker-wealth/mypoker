import {
  estimateDaysToNextTier,
  scoreFor,
  tierOf,
  VERY_POOR_CEILING,
  DEDUCTION,
  GOOD_STANDING_SCORE,
  vipProgress,
  VIP_TIERS,
  tierForVolume,
} from '../../src/players/index';

/**
 * These cases moved here from financial-core when the duplicated rule copies
 * were deleted — the derivations now have exactly one home, this package, and
 * these tests pin it. If financial-core ever grows a score or a tier ladder
 * again, the audit that removed the first copy explains why it must not.
 */

const $ = (dollars: number): number => Math.round(dollars * 1_000_000);

describe('scoreFor — facts in, score out', () => {
  it('starts a new account at 500 / AVERAGE', () => {
    expect(scoreFor(0, [])).toBe(500);
    expect(tierOf(scoreFor(0, []))).toBe('AVERAGE');
  });

  it('advances to 700 / GOOD at exactly 100 rounds, not 99', () => {
    expect(scoreFor(99, [])).toBe(500);
    expect(scoreFor(100, [])).toBe(GOOD_STANDING_SCORE);
    expect(tierOf(scoreFor(100, []))).toBe('GOOD');
  });

  it('does not keep climbing past 700', () => {
    expect(scoreFor(5000, [])).toBe(700);
  });

  it('applies the spec deduction amounts', () => {
    expect(scoreFor(0, ['CHALLENGE_FAIL'])).toBe(480);
    expect(scoreFor(0, ['BOT_CONFIRMED'])).toBe(350);
    expect(scoreFor(0, ['CHALLENGE_FAIL', 'BOT_CONFIRMED'])).toBe(330);
  });

  it('drops a confirmed colluder directly to VERY_POOR', () => {
    // Spec §10.1: collusion "drops directly to this tier". Plain subtraction
    // does not achieve it — 500−200=300 is the floor of POOR — so the ceiling
    // is enforced.
    const fresh = scoreFor(0, ['COLLUSION_CONFIRMED']);
    expect(fresh).toBeLessThanOrEqual(VERY_POOR_CEILING);
    expect(tierOf(fresh)).toBe('VERY_POOR');

    // An advanced 700 player would otherwise land on 500 (AVERAGE).
    const advanced = scoreFor(100, ['COLLUSION_CONFIRMED']);
    expect(tierOf(advanced)).toBe('VERY_POOR');
  });

  it('never goes below zero', () => {
    const reasons = Array(5).fill('COLLUSION_CONFIRMED') as 'COLLUSION_CONFIRMED'[];
    expect(scoreFor(0, reasons)).toBe(0);
  });

  it('deduction table matches the spec', () => {
    expect(DEDUCTION.CHALLENGE_FAIL).toBe(20);
    expect(DEDUCTION.BOT_CONFIRMED).toBe(150);
    expect(DEDUCTION.COLLUSION_CONFIRMED).toBe(200);
  });
});

describe('vipProgress — the one ladder', () => {
  it('carries the spec’s titles (v5.9 §10.2)', () => {
    // These were Bronze/Silver/Gold/Diamond/Black Gold, attributed to an owner
    // renaming on Jul 15 that no document in the repo records. The spec is the
    // only written source, and Victor's instruction is to follow it.
    expect(VIP_TIERS.map((t) => t.title)).toEqual([
      'Wanderer',
      'Rising Star',
      'Gold',
      'Platinum',
      'Black Gold',
    ]);
  });

  it('matches the spec thresholds exactly', () => {
    expect(tierForVolume($(9_999)).tier).toBe('V1');
    expect(tierForVolume($(10_000)).tier).toBe('V2');
    expect(tierForVolume($(100_000)).tier).toBe('V3');
    expect(tierForVolume($(500_000)).tier).toBe('V4');
    expect(tierForVolume($(2_000_000)).tier).toBe('V5');
  });

  it('measures progress between thresholds, not from zero', () => {
    // $300k: V3 ($100k) heading to V4 ($500k) — half way, not 60%.
    const p = vipProgress($(300_000));
    expect(p.tier).toBe('V3');
    expect(p.next!.tier).toBe('V4');
    expect(p.next!.remaining).toBe($(200_000));
    expect(p.progressPct).toBe(50);
  });

  it('reports no next tier at V5', () => {
    const p = vipProgress($(2_000_000));
    expect(p.tier).toBe('V5');
    expect(p.next).toBeNull();
    expect(p.progressPct).toBe(100);
  });

  it('starts a new player at V1 with V2 ahead', () => {
    const p = vipProgress(0);
    expect(p.tier).toBe('V1');
    expect(p.next!.tier).toBe('V2');
    expect(p.next!.remaining).toBe($(10_000));
  });
});

describe('estimateDaysToNextTier — §10.2 "estimated upgrade time"', () => {
  it('projects from this month’s pace', () => {
    // $300 of effective volume over 10 days = $30/day; $600 remaining = 20 days.
    expect(
      estimateDaysToNextTier({ remaining: $(600), monthlyEffective: $(300), daysElapsed: 10 }),
    ).toBe(20);
  });

  it('gives no estimate in the first days of a month', () => {
    // One good session on the 2nd projects to a number that is simply noise.
    expect(
      estimateDaysToNextTier({ remaining: $(600), monthlyEffective: $(300), daysElapsed: 2 }),
    ).toBeNull();
  });

  it('gives no estimate at zero pace', () => {
    // "Never" is not an estimate, and infinity renders badly.
    expect(
      estimateDaysToNextTier({ remaining: $(600), monthlyEffective: 0, daysElapsed: 20 }),
    ).toBeNull();
  });

  it('gives no estimate when nothing is remaining', () => {
    expect(
      estimateDaysToNextTier({ remaining: 0, monthlyEffective: $(300), daysElapsed: 20 }),
    ).toBeNull();
  });

  it('rounds up, so the estimate never promises early', () => {
    // 21 days of pace, not 20.4 rounded down.
    expect(
      estimateDaysToNextTier({ remaining: $(613), monthlyEffective: $(300), daysElapsed: 10 }),
    ).toBe(21);
  });
});
