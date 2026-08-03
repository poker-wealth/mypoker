import {
  reconcileVip,
  tierForVolume,
  newVipState,
  GRACE_PERIOD_DAYS,
} from '../../src/players/vip';
import {
  antiBotScore,
  requiresHumanReview,
  decisionTimeGate,
  doubleConfirmGate,
} from '../../src/players/anti-bot';
import {
  levelForScore,
  automatedAction,
  isAssociated,
  groupTableLimitOk,
  confirmByHuman,
} from '../../src/players/collusion';

const USD = 1_000_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 1, 0, 0, 0);

describe('VIP — volume tiers', () => {
  it('maps cumulative volume to the right tier', () => {
    expect(tierForVolume(0).tier).toBe('V1');
    expect(tierForVolume(10_000 * USD).tier).toBe('V2');
    expect(tierForVolume(100_000 * USD).tier).toBe('V3');
    expect(tierForVolume(500_000 * USD).tier).toBe('V4');
    expect(tierForVolume(5_000_000 * USD).tier).toBe('V5');
  });

  it('upgrades immediately when volume is reached', () => {
    const next = reconcileVip(newVipState(), 100_000 * USD, T0);
    expect(next.currentTier).toBe('V3');
    expect(next.belowSince).toBeNull();
  });
});

describe('VIP — demotion with a 30-day grace, then drop ONE tier', () => {
  it('holds the tier through the grace period', () => {
    const v3 = { currentTier: 'V3' as const, belowSince: null };
    // Volume has fallen below V3, but we are only 10 days in → still V3.
    const held = reconcileVip(v3, 0, T0 + 10 * DAY);
    expect(held.currentTier).toBe('V3');
    expect(held.belowSince).toBe(T0 + 10 * DAY - 0); // grace clock started
  });

  it('drops exactly one tier after grace, never to the bottom', () => {
    const belowSince = T0;
    const v3 = { currentTier: 'V3' as const, belowSince };
    // 31 days below V3 with zero volume → drops to V2, NOT straight to V1.
    const dropped = reconcileVip(v3, 0, belowSince + (GRACE_PERIOD_DAYS + 1) * DAY);
    expect(dropped.currentTier).toBe('V2');
  });

  it('a recovered player upgrades again immediately, clearing the grace clock', () => {
    const slipping = { currentTier: 'V3' as const, belowSince: T0 };
    const recovered = reconcileVip(slipping, 100_000 * USD, T0 + 5 * DAY);
    expect(recovered.currentTier).toBe('V3');
    expect(recovered.belowSince).toBeNull();
  });
});

describe('Anti-Bot — behavioural score', () => {
  it('accumulates from independent signals up to 100', () => {
    expect(antiBotScore({ fixedReactionDelay: false, perfectRandomTiming: false, alwaysExactGtoSizing: false, noFatigueOverLongSession: false })).toBe(0);
    expect(antiBotScore({ fixedReactionDelay: true, perfectRandomTiming: true, alwaysExactGtoSizing: true, noFatigueOverLongSession: true })).toBe(100);
    expect(requiresHumanReview(60)).toBe(true);
    expect(requiresHumanReview(59)).toBe(false);
  });
});

describe('Anti-Bot — hard input gates reject inhuman timing', () => {
  it('rejects a sub-3s decision on a complex (all-in) board', () => {
    expect(decisionTimeGate(2999, true).ok).toBe(false);
    expect(decisionTimeGate(3000, true).ok).toBe(true);
    expect(decisionTimeGate(10, false).ok).toBe(true); // simple board: no minimum
  });

  it('rejects a double-confirm faster than 1 second apart', () => {
    expect(doubleConfirmGate(1000, 1999).ok).toBe(false);
    expect(doubleConfirmGate(1000, 2000).ok).toBe(true);
  });
});

describe('Collusion — graduated, human-gated', () => {
  it('scores into levels and the AUTOMATED action never exceeds human review', () => {
    expect(levelForScore(20)).toBe('LOW');
    expect(levelForScore(50)).toBe('MEDIUM');
    expect(levelForScore(90)).toBe('HIGH');
    expect(automatedAction(20)).toBe('MONITOR');
    expect(automatedAction(50)).toBe('BAN_SAME_TABLE'); // same table only
    expect(automatedAction(100)).toBe('HUMAN_REVIEW'); // AI ceiling — no auto perma-ban
  });

  it('association needs GPS AND (IP or WiFi)', () => {
    const a = { gps: 'g1', ip: 'i1', wifi: 'w1' };
    expect(isAssociated(a, { gps: 'g1', ip: 'i1', wifi: 'wX' })).toBe(true); // GPS+IP
    expect(isAssociated(a, { gps: 'g1', ip: 'iX', wifi: 'w1' })).toBe(true); // GPS+WiFi
    expect(isAssociated(a, { gps: 'gX', ip: 'i1', wifi: 'w1' })).toBe(false); // no GPS match
    expect(isAssociated(a, { gps: 'g1', ip: 'iX', wifi: 'wX' })).toBe(false); // GPS only
  });

  it('an associated group may use at most 3 tables at once', () => {
    expect(groupTableLimitOk(3)).toBe(true);
    expect(groupTableLimitOk(4)).toBe(false);
  });

  it('seizure + permanent ban is reachable ONLY through a human, and follows the scope', () => {
    expect(confirmByHuman('ops-jane', 'PLATFORM')).toEqual({
      action: 'SEIZE_AND_PERMABAN',
      seizeTo: 'TREASURY',
      reviewerId: 'ops-jane',
    });
    expect(confirmByHuman('ops-jane', 'LEAGUE').seizeTo).toBe('LEAGUE_INVENTORY');
    expect(() => confirmByHuman('', 'PLATFORM')).toThrow(/reviewer/);
  });
});
