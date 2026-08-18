import {
  antiBotScore,
  requiresHumanReview,
  decisionTimeGate,
  doubleConfirmGate,
  type BehaviorSignals,
} from '../../src/players/anti-bot';

const NONE: BehaviorSignals = {
  fixedReactionDelay: false,
  perfectRandomTiming: false,
  alwaysExactGtoSizing: false,
  noFatigueOverLongSession: false,
};

describe('anti-bot', () => {
  it('scores 0 with no signals and 100 with all', () => {
    expect(antiBotScore(NONE)).toBe(0);
    expect(antiBotScore({ ...NONE, fixedReactionDelay: true, perfectRandomTiming: true, alwaysExactGtoSizing: true, noFatigueOverLongSession: true })).toBe(100);
  });

  it('flags for human review at the threshold — and never auto-bans', () => {
    // Two timing tells = 60 = the review threshold. A flag is a human review, not a ban.
    const score = antiBotScore({ ...NONE, fixedReactionDelay: true, perfectRandomTiming: true });
    expect(score).toBe(60);
    expect(requiresHumanReview(score)).toBe(true);
    expect(requiresHumanReview(59)).toBe(false);
  });

  describe('decisionTimeGate — the 3s-min hard gate the room now enforces', () => {
    it('never gates a non-complex board, however fast', () => {
      expect(decisionTimeGate(10, false).ok).toBe(true);
    });
    it('rejects a sub-3s action on a complex board (default threshold)', () => {
      expect(decisionTimeGate(500, true)).toEqual({ ok: false, reason: 'decision under 3000ms on a complex board' });
    });
    it('allows a human-speed action on a complex board', () => {
      expect(decisionTimeGate(3200, true).ok).toBe(true);
    });
    it('honours a custom per-table minMs (what PokerRoom passes)', () => {
      expect(decisionTimeGate(1500, true, 1000).ok).toBe(true); // 1500 ≥ 1000
      expect(decisionTimeGate(900, true, 1000).ok).toBe(false); // 900 < 1000
    });
  });

  describe('doubleConfirmGate', () => {
    it('rejects two clicks under 1s apart', () => {
      expect(doubleConfirmGate(1000, 1500).ok).toBe(false);
    });
    it('allows two clicks at least 1s apart', () => {
      expect(doubleConfirmGate(1000, 2000).ok).toBe(true);
    });
  });
});
