/**
 * Anti-Bot (FairPlay v5.9 §8.3) — an INDEPENDENT 0–100 behavioural-biometrics score, plus the two
 * hard input gates that reject inhuman timing outright.
 *
 * THE IRON RULE (enforced by keeping this module free of any reputation import): the anti-bot score
 * NEVER auto-changes reputation and NEVER auto-bans. A high score is a flag for a human to review —
 * `requiresHumanReview()` — and only a human decision (elsewhere) may then deduct reputation. AI on
 * its own does nothing punitive here.
 *
 * Philosophy: raise the cost of botting, don't claim to block it perfectly. Zero external cost.
 */

export interface BehaviorSignals {
  /** Reaction times (ms) show a fixed delay or a mathematically perfect distribution — bot tells. */
  fixedReactionDelay: boolean;
  perfectRandomTiming: boolean;
  /** Bets are ALWAYS exact GTO ratios (33/50/75%), never approximate. */
  alwaysExactGtoSizing: boolean;
  /** 16+ hours continuous with zero variance in VPIP/stats — no human fatigue. */
  noFatigueOverLongSession: boolean;
}

const SIGNAL_WEIGHT: Readonly<Record<keyof BehaviorSignals, number>> = {
  fixedReactionDelay: 30,
  perfectRandomTiming: 30,
  alwaysExactGtoSizing: 20,
  noFatigueOverLongSession: 20,
};

/** Accumulate the 0–100 anti-bot score from observed signals. Higher = more bot-like. */
export function antiBotScore(signals: BehaviorSignals): number {
  let score = 0;
  for (const key of Object.keys(SIGNAL_WEIGHT) as (keyof BehaviorSignals)[]) {
    if (signals[key]) score += SIGNAL_WEIGHT[key];
  }
  return Math.min(100, score);
}

export const HUMAN_REVIEW_THRESHOLD = 60;

/** A high score only ever FLAGS for a human. It never bans and never touches reputation on its own. */
export function requiresHumanReview(score: number): boolean {
  return score >= HUMAN_REVIEW_THRESHOLD;
}

// ── Hard input gates (these DO reject in-line — they judge one action's timing, not the player) ──

export const MIN_DECISION_MS_COMPLEX = 3000; // complex board / someone all-in
export const DOUBLE_CONFIRM_GAP_MS = 1000; // all-in or raise > 100% pot needs 2 clicks ≥ 1s apart

export type ActionGate = { ok: true } | { ok: false; reason: string };

/**
 * On a complex board (someone is all-in), a decision faster than 3s is rejected — no human reads a
 * multi-way all-in that fast. This gates the ACTION; it does not itself accuse the player.
 */
export function decisionTimeGate(
  elapsedMs: number,
  complexBoard: boolean,
  minMs: number = MIN_DECISION_MS_COMPLEX,
): ActionGate {
  if (complexBoard && elapsedMs < minMs) {
    return { ok: false, reason: `decision under ${minMs}ms on a complex board` };
  }
  return { ok: true };
}

/** A big commitment (all-in / raise > 100% pot) needs two clicks at least a second apart. */
export function doubleConfirmGate(firstClickMs: number, secondClickMs: number): ActionGate {
  if (secondClickMs - firstClickMs < DOUBLE_CONFIRM_GAP_MS) {
    return { ok: false, reason: 'major action confirmed too fast — needs 2 clicks ≥ 1s apart' };
  }
  return { ok: true };
}
