import { antiBotScore, requiresHumanReview, type BehaviorSignals } from './anti-bot';
import { behaviorStatusFor, type BehaviorStatus } from './collusion';
import { canAccessTable, canChat, tierOf, withdrawalGate, type ReputationTier } from './reputation';
import { reconcileVip, vipSpec, type VipState, type VipTier } from './vip';

/**
 * PlayerStanding — one player's three INDEPENDENT standings, held together but walled apart.
 *
 * The spec is emphatic (v5.9 §8.3, §10.1) that these must not bleed into each other, because each
 * bleed is a real harm: a bot-detector that silently tanks reputation punishes false positives, and
 * a reputation score that gates withdrawals traps a player's money. So the walls are structural:
 *
 *   • Reputation ⇒ table access + chat only. `canWithdraw()` ignores it entirely.
 *   • Anti-bot score ⇒ a human-review FLAG only. It does not move reputation here; only an explicit
 *     human decision (`applyHumanFinding`) may.
 *   • VIP ⇒ withdrawal SPEED (queue priority), never withdrawal ELIGIBILITY.
 */

export interface StandingInput {
  reputationScore: number;
  cumulativeVolume: number;
  vip: VipState;
  behaviorSignals: BehaviorSignals;
  collusionConfirmed: boolean;
  flaggedByReview: boolean;
}

export interface StandingView {
  reputation: { score: number; tier: ReputationTier };
  vip: { tier: VipTier; title: string; withdrawalPriority: number };
  antiBot: { score: number; needsHumanReview: boolean };
  behaviorStatus: BehaviorStatus; // what the jackpot weighting consumes
}

export function computeStanding(input: StandingInput, now: number): StandingView {
  const vip = reconcileVip(input.vip, input.cumulativeVolume, now);
  const vipInfo = vipSpec(vip.currentTier);
  const abScore = antiBotScore(input.behaviorSignals);
  return {
    reputation: { score: input.reputationScore, tier: tierOf(input.reputationScore) },
    vip: { tier: vip.currentTier, title: vipInfo.title, withdrawalPriority: vipInfo.withdrawalPriority },
    antiBot: { score: abScore, needsHumanReview: requiresHumanReview(abScore) },
    behaviorStatus: behaviorStatusFor({
      collusionConfirmed: input.collusionConfirmed,
      flaggedByReview: input.flaggedByReview,
    }),
  };
}

/** Table access — reputation gates the stake; nothing else here. */
export function mayJoinTable(reputationScore: number, stake: number): boolean {
  return canAccessTable(reputationScore, stake);
}

export function mayChat(reputationScore: number): boolean {
  return canChat(reputationScore);
}

/**
 * THE MONEY FIREWALL. Withdrawal is never gated by reputation, anti-bot score, or VIP tier — those
 * are passed in only to prove they are ignored. Eligibility lives in the Financial Core.
 */
export function canWithdraw(_view: StandingView): { allowed: true; note: string } {
  void withdrawalGate(_view.reputation.score); // documents the independence
  return { allowed: true, note: 'standing never gates withdrawals; only the Financial Core does' };
}

/**
 * The ONLY way an anti-bot / collusion finding moves reputation: a human signs off. AI never calls
 * this. Returns the new reputation score after the human-approved deduction.
 */
export function applyHumanFinding(
  reputationScore: number,
  finding: { deduction: number; reviewerId: string },
): number {
  if (!finding.reviewerId) throw new Error('a reputation change from a finding needs a human reviewer');
  return Math.max(0, reputationScore - Math.abs(finding.deduction));
}

/** Map a standing to the jackpot candidate fields (behavior + association). */
export function toJackpotBehavior(view: StandingView, associated: boolean): {
  behavior: BehaviorStatus;
  associated: boolean;
} {
  return { behavior: view.behaviorStatus, associated };
}
