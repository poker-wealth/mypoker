import { antiBotScore, requiresHumanReview, type BehaviorSignals } from './anti-bot';
import type { BehaviorStatus } from '../jackpot/weights';

/**
 * Per-seat behaviour collection — the LIVE inputs the anti-bot score (§8.3) is computed from, and the
 * bridge to the jackpot candidate weighting (jackpot/weights.ts).
 *
 * The room records one `DecisionSample` per action a seat takes: how long the decision took (from the
 * seat's turn starting to the action landing) and, for a bet/raise, its size as a fraction of the
 * pot. From the accumulated samples this derives the four `BehaviorSignals` that `antiBotScore()`
 * weights, and maps the score to a jackpot `BehaviorStatus`:
 *
 *   score  < 60 (human-review threshold)  ->  NORMAL   (full jackpot weight)
 *   score >= 60                           ->  FLAGGED  (half weight — never a ban)
 *
 * FLAGGED only HALVES jackpot weight. In line with §8.3 it never bans, never touches reputation and
 * never blocks a withdrawal — the whole point of an independent anti-bot score. COLLUDING (weight 0)
 * is a separate, human-confirmed decision and is NOT produced here. A seat with too little evidence is
 * NORMAL by default: a false flag costs a player only a little jackpot weight, but we would still far
 * rather under-flag than misjudge a human on a short sample.
 *
 * The heuristics are deliberately conservative — every signal needs a floor of samples, and no single
 * signal reaches the flag threshold alone (a real flag needs two tells to agree). They raise the cost
 * of botting; they do not claim to prove it.
 */

export interface DecisionSample {
  /** ms from the seat's turn starting to the action landing. */
  reactionMs: number;
  /** Bet size as a fraction of the pot (raise-to / pot), or null for check/call/fold. */
  betRatio: number | null;
  /** Wall-clock ms of the action — the fatigue signal needs real elapsed session time. */
  at: number;
}

// Every signal needs a floor of evidence before it may fire.
const MIN_TIMING_SAMPLES = 8;
const MIN_UNIFORM_SAMPLES = 14;
const MIN_BET_SAMPLES = 6;

/** A fixed-delay bot's reaction times barely vary; a human's always do. */
const FIXED_DELAY_MAX_CV = 0.12;
/** "Perfect random" timing is suspiciously FLAT across a wide range, where a human clusters. */
const UNIFORM_MIN_RANGE_MS = 2_000;
const UNIFORM_MAX_BIN_SPREAD = 0.15;
/** Exact GTO ratios a bot snaps to; a human eyeballs and misses. */
const GTO_RATIOS = [1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 3 / 2, 2] as const;
const GTO_TOLERANCE = 0.01;
const GTO_EXACT_FRACTION = 0.95;
/** No human plays 16h with zero degradation in timing. */
const FATIGUE_SESSION_MS = 16 * 60 * 60 * 1000;

const MAX_SAMPLES = 512; // bound memory; keep the most recent

function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export class BehaviorTracker {
  private samples: DecisionSample[] = [];
  private sessionStart: number | null = null;

  /** Record one decision. Ignores a nonsensical (negative / non-finite) reaction outright. */
  record(s: DecisionSample): void {
    if (!Number.isFinite(s.reactionMs) || s.reactionMs < 0) return;
    if (this.sessionStart === null) this.sessionStart = s.at;
    this.samples.push(s);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  /** How many decisions we have on this seat — enough to judge, or not. */
  get size(): number {
    return this.samples.length;
  }

  signals(now: number): BehaviorSignals {
    const reactions = this.samples.map((s) => s.reactionMs);
    const bets = this.samples.map((s) => s.betRatio).filter((r): r is number => r !== null);
    return {
      fixedReactionDelay: this.fixedDelay(reactions),
      perfectRandomTiming: this.perfectRandom(reactions),
      alwaysExactGtoSizing: this.alwaysExactGto(bets),
      noFatigueOverLongSession: this.noFatigue(now, reactions),
    };
  }

  /** The jackpot behaviour status for this seat, from the accumulated signals. */
  status(now: number): BehaviorStatus {
    return requiresHumanReview(antiBotScore(this.signals(now))) ? 'FLAGGED' : 'NORMAL';
  }

  private fixedDelay(reactions: readonly number[]): boolean {
    if (reactions.length < MIN_TIMING_SAMPLES) return false;
    const m = mean(reactions);
    if (m <= 0) return false;
    return stdev(reactions) / m < FIXED_DELAY_MAX_CV;
  }

  private perfectRandom(reactions: readonly number[]): boolean {
    if (reactions.length < MIN_UNIFORM_SAMPLES) return false;
    const min = Math.min(...reactions);
    const max = Math.max(...reactions);
    if (max - min < UNIFORM_MIN_RANGE_MS) return false; // too little spread to call it flat
    // Three equal-width bins. A human's times cluster (one bin runs heavy); PRNG-driven timing spreads
    // them evenly, so every bin holds ~a third. Flag only when the bins are near-equal.
    const bins = [0, 0, 0];
    const width = (max - min) / 3;
    for (const r of reactions) {
      const idx = Math.min(2, Math.floor((r - min) / width));
      bins[idx] = (bins[idx] ?? 0) + 1;
    }
    const fractions = bins.map((b) => b / reactions.length);
    return Math.max(...fractions) - Math.min(...fractions) < UNIFORM_MAX_BIN_SPREAD;
  }

  private alwaysExactGto(bets: readonly number[]): boolean {
    if (bets.length < MIN_BET_SAMPLES) return false;
    const exact = bets.filter((b) => GTO_RATIOS.some((r) => Math.abs(b - r) <= GTO_TOLERANCE));
    return exact.length / bets.length >= GTO_EXACT_FRACTION;
  }

  private noFatigue(now: number, reactions: readonly number[]): boolean {
    if (this.sessionStart === null || now - this.sessionStart < FATIGUE_SESSION_MS) return false;
    if (reactions.length < MIN_TIMING_SAMPLES * 2) return false;
    // A tired human's timing grows slower AND more variable over a long session; a bot's does not.
    const q = Math.floor(reactions.length / 4);
    const early = reactions.slice(0, q);
    const late = reactions.slice(-q);
    return stdev(late) <= stdev(early) * 1.1;
  }
}
