import { DEDUCTION } from './reputation';

/**
 * Peer Challenge (FairPlay v5.9 §8.2) — crowd-sourced bot patrol. Players challenge a suspected bot;
 * the target must pass a human-verification popup. The rules exist to make this useful for catching
 * bots while being useless for harassment:
 *
 *   • Different targets: unlimited. Same target: at most once per day per challenger.
 *   • Global cooldown: a target sees at most ONE popup per 60 minutes, however many people challenge
 *     — this defeats wolf-pack tactics.
 *   • Post-pass protection: after passing, every challenge in the next 60 minutes is silently judged
 *     passed, so a verified human is never interrupted mid-game.
 *   • Blowback: if the target passes in under 10 seconds (obviously human), the challenger cannot
 *     challenge them again that day — this punishes spite-challenging.
 *   • Race fix (spec §8.2): protection window = max(trigger + 60m, lastPass + 60m), closing a
 *     boundary exploit where a challenge fired right before a pass could re-trigger immediately.
 *
 * A failed challenge deducts 20 reputation and restricts the target from re-entering the table next
 * round — access only, never funds.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
export const GLOBAL_COOLDOWN_MS = HOUR_MS;
export const POST_PASS_PROTECTION_MS = HOUR_MS;
export const OBVIOUSLY_HUMAN_MS = 10_000;

export interface TargetState {
  /** When the last popup was shown to this target (drives the 60-min global cooldown). */
  lastPromptAt: number | null;
  /** When this target last passed a challenge (drives post-pass protection + race fix). */
  lastPassAt: number | null;
  /** Challenger ids that may not challenge this target again today, → the day-key they were set on. */
  blockedChallengers: Map<string, number>;
  /** Challenger ids that have already challenged this target today. */
  challengedToday: Map<string, number>;
}

export function newTargetState(): TargetState {
  return {
    lastPromptAt: null,
    lastPassAt: null,
    blockedChallengers: new Map(),
    challengedToday: new Map(),
  };
}

const dayKey = (ts: number): number => Math.floor(ts / DAY_MS);

/** The protection deadline: max of the last prompt+60m and the last pass+60m (the race fix). */
function protectedUntil(state: TargetState): number {
  const fromPrompt = state.lastPromptAt !== null ? state.lastPromptAt + GLOBAL_COOLDOWN_MS : 0;
  const fromPass = state.lastPassAt !== null ? state.lastPassAt + POST_PASS_PROTECTION_MS : 0;
  return Math.max(fromPrompt, fromPass);
}

export type ChallengeDecision =
  | { outcome: 'PROMPT' } // show the target a verification popup
  | { outcome: 'AUTO_PASS'; reason: string } // silently passed (protection window)
  | { outcome: 'REJECTED'; reason: string }; // challenger not allowed right now

/**
 * Decide what a challenge from `challengerId` against a target does, given the target's state.
 * Pure — it does not mutate; call `recordPrompt` / `recordResult` to advance state.
 */
export function evaluateChallenge(
  state: TargetState,
  challengerId: string,
  now: number,
): ChallengeDecision {
  // Blowback: spite-challenger is blocked from this target for the rest of the day.
  if (state.blockedChallengers.get(challengerId) === dayKey(now)) {
    return { outcome: 'REJECTED', reason: 'you already challenged a verified human today' };
  }
  // Same target, same challenger, same day → at most once.
  if (state.challengedToday.get(challengerId) === dayKey(now)) {
    return { outcome: 'REJECTED', reason: 'one challenge per target per day' };
  }
  // Inside the protection window (global cooldown OR post-pass) → silently pass, no interruption.
  if (now < protectedUntil(state)) {
    return { outcome: 'AUTO_PASS', reason: 'target is within its protection window' };
  }
  return { outcome: 'PROMPT' };
}

/** Record that a popup was shown (starts the 60-min global cooldown). */
export function recordPrompt(state: TargetState, challengerId: string, now: number): void {
  state.lastPromptAt = now;
  state.challengedToday.set(challengerId, dayKey(now));
}

export interface ChallengeResult {
  passed: boolean;
  /** How long the target took to respond (ms). */
  responseMs: number;
}

export interface ChallengeConsequence {
  reputationDelta: number;
  restrictFromTableNextRound: boolean;
  notifyOps: boolean;
}

/**
 * Apply a challenge outcome. On pass: record it (starts post-pass protection) and, if the target was
 * obviously human (<10s), block the challenger from re-challenging today. On fail: −20 reputation and
 * a next-round table restriction (access only), and ops/league are notified.
 */
export function recordResult(
  state: TargetState,
  challengerId: string,
  result: ChallengeResult,
  now: number,
): ChallengeConsequence {
  if (result.passed) {
    state.lastPassAt = now;
    if (result.responseMs < OBVIOUSLY_HUMAN_MS) {
      state.blockedChallengers.set(challengerId, dayKey(now)); // anti-spite blowback
    }
    return { reputationDelta: 0, restrictFromTableNextRound: false, notifyOps: false };
  }
  return {
    reputationDelta: -DEDUCTION.CHALLENGE_FAIL,
    restrictFromTableNextRound: true,
    notifyOps: true,
  };
}
