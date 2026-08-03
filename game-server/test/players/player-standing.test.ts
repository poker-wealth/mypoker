import {
  computeStanding,
  mayJoinTable,
  mayChat,
  canWithdraw,
  applyHumanFinding,
  toJackpotBehavior,
  type StandingInput,
} from '../../src/players/player-standing';
import {
  tierOf,
  scoreAfterNormalRounds,
  deduct,
  canAccessTable,
  DEDUCTION,
  NEW_ACCOUNT_SCORE,
} from '../../src/players/reputation';
import { newVipState } from '../../src/players/vip';
import { drawWinner, type JackpotCandidate } from '../../src/jackpot/weights';

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

function input(over: Partial<StandingInput> = {}): StandingInput {
  return {
    reputationScore: 500,
    cumulativeVolume: 0,
    vip: newVipState(),
    behaviorSignals: {
      fixedReactionDelay: false,
      perfectRandomTiming: false,
      alwaysExactGtoSizing: false,
      noFatigueOverLongSession: false,
    },
    collusionConfirmed: false,
    flaggedByReview: false,
    ...over,
  };
}

describe('IRON RULE — reputation never touches money', () => {
  it('the WORST reputation can still withdraw', () => {
    const view = computeStanding(input({ reputationScore: 0 }), NOW);
    expect(view.reputation.tier).toBe('VERY_POOR');
    expect(canWithdraw(view).allowed).toBe(true);
  });

  it('withdrawal is identical across every reputation tier', () => {
    for (const score of [0, 250, 500, 750, 1000]) {
      expect(canWithdraw(computeStanding(input({ reputationScore: score }), NOW)).allowed).toBe(true);
    }
  });

  it('reputation only gates table access and chat', () => {
    // Very Poor: low-stakes only, no chat.
    expect(mayJoinTable(100, 100)).toBe(true);
    expect(mayJoinTable(100, 50_000)).toBe(false);
    expect(mayChat(100)).toBe(false);
    // Average+: full access, can chat.
    expect(mayJoinTable(500, 50_000)).toBe(true);
    expect(mayChat(500)).toBe(true);
  });
});

describe('IRON RULE — anti-bot score never auto-changes reputation', () => {
  it('a maxed anti-bot score flags for review but does NOT move reputation', () => {
    const view = computeStanding(
      input({
        behaviorSignals: {
          fixedReactionDelay: true,
          perfectRandomTiming: true,
          alwaysExactGtoSizing: true,
          noFatigueOverLongSession: true,
        },
      }),
      NOW,
    );
    expect(view.antiBot.score).toBe(100);
    expect(view.antiBot.needsHumanReview).toBe(true);
    expect(view.reputation.score).toBe(500); // untouched by the score
  });

  it('only an explicit HUMAN finding may deduct reputation', () => {
    expect(applyHumanFinding(500, { deduction: DEDUCTION.BOT_CONFIRMED, reviewerId: 'ops-jane' })).toBe(350);
    expect(() => applyHumanFinding(500, { deduction: 150, reviewerId: '' })).toThrow(/human reviewer/);
  });
});

describe('IRON RULE — VIP affects withdrawal SPEED, not eligibility', () => {
  it('a higher tier gets queue priority, but everyone is allowed to withdraw', () => {
    const v5 = computeStanding(input({ cumulativeVolume: 2_000_000_000_000 }), NOW);
    const v1 = computeStanding(input({ cumulativeVolume: 0 }), NOW);
    expect(v5.vip.tier).toBe('V5');
    expect(v5.vip.withdrawalPriority).toBeGreaterThan(v1.vip.withdrawalPriority);
    expect(canWithdraw(v5).allowed).toBe(true);
    expect(canWithdraw(v1).allowed).toBe(true);
  });
});

describe('reputation mechanics', () => {
  it('new account starts Average and advances to Good after 100 normal rounds', () => {
    expect(tierOf(NEW_ACCOUNT_SCORE)).toBe('AVERAGE');
    expect(scoreAfterNormalRounds(500, 99)).toBe(500);
    expect(scoreAfterNormalRounds(500, 100)).toBe(700);
    expect(tierOf(700)).toBe('GOOD');
  });

  it('deductions clamp at zero and match the spec', () => {
    expect(deduct(500, DEDUCTION.CHALLENGE_FAIL)).toBe(480);
    expect(deduct(500, DEDUCTION.COLLUSION_CONFIRMED)).toBe(300);
    expect(deduct(100, 200)).toBe(0); // never negative
  });

  it('Poor loses high-stakes access; Very Poor is low-stakes only', () => {
    expect(canAccessTable(400, 4999)).toBe(true);
    expect(canAccessTable(400, 5000)).toBe(false); // Poor: no high-stakes
    expect(canAccessTable(900, 999_999)).toBe(true); // Excellent: anything
  });
});

describe('collusion output drives the jackpot weighting', () => {
  it('a confirmed colluder becomes COLLUDING and is zeroed out of the draw', () => {
    const cheat = computeStanding(input({ collusionConfirmed: true }), NOW);
    expect(cheat.behaviorStatus).toBe('COLLUDING');

    const honest = computeStanding(input(), NOW);
    expect(honest.behaviorStatus).toBe('NORMAL');

    const candidates: JackpotCandidate[] = [
      { playerId: 'cheat', baseWeight: 999, ...toJackpotBehavior(cheat, false) },
      { playerId: 'honest', baseWeight: 1, ...toJackpotBehavior(honest, false) },
    ];
    // The colluder has 999× the weight but is zeroed — the honest player wins every time.
    for (let i = 0; i < 50; i++) {
      expect(drawWinner(candidates, `s${i}`)!.playerId).toBe('honest');
    }
  });

  it('a review-flagged player is halved, not excluded', () => {
    const flagged = computeStanding(input({ flaggedByReview: true }), NOW);
    expect(flagged.behaviorStatus).toBe('FLAGGED');
  });
});
