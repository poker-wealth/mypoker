/**
 * VIP (FairPlay v5.9 §10.2) — five tiers earned by CUMULATIVE VOLUME, never by deposits or losses.
 *
 * Core design: no cashback. Privileges are made good enough that losing rank hurts. Upgrades are
 * immediate; a downgrade only happens after a 30-day grace period and then drops just ONE tier
 * (never straight to the bottom), so a single quiet month can't wipe out a player's status.
 *
 * VIP is a THIRD independent axis: it is not reputation and not the anti-bot score. It touches
 * withdrawal *speed* (queue priority), never withdrawal *eligibility*.
 */

export type VipTier = 'V1' | 'V2' | 'V3' | 'V4' | 'V5';

export interface VipTierSpec {
  tier: VipTier;
  title: string;
  /** Cumulative volume (micro-USD) required to hold this tier. */
  volumeRequired: number;
  /** Withdrawal queue priority: higher jumps the line. Speed only — never eligibility. */
  withdrawalPriority: number;
  /** V5 only: chain-level instant auto-transfer under the per-tx / 24h caps. */
  instantAutoTransfer: boolean;
  proTrackerHud: boolean;
}

const USD = 1_000_000;

// Titles and thresholds per FairPlay v5.9 §10.2.
//
// These carried owner-branding labels (Bronze/Silver/Gold/Diamond/Black Gold) attributed to a
// Jul 15 renaming, but no document in the repo records that decision, and the spec is the only
// written source. Restored to spec on Victor's instruction. Internal ids stay V1–V5, so nothing
// downstream keys off the label.
export const VIP_TIERS: readonly VipTierSpec[] = [
  { tier: 'V1', title: 'Wanderer', volumeRequired: 0, withdrawalPriority: 0, instantAutoTransfer: false, proTrackerHud: false },
  { tier: 'V2', title: 'Rising Star', volumeRequired: 10_000 * USD, withdrawalPriority: 1, instantAutoTransfer: false, proTrackerHud: false },
  { tier: 'V3', title: 'Gold', volumeRequired: 100_000 * USD, withdrawalPriority: 2, instantAutoTransfer: false, proTrackerHud: true },
  { tier: 'V4', title: 'Platinum', volumeRequired: 500_000 * USD, withdrawalPriority: 3, instantAutoTransfer: false, proTrackerHud: true },
  { tier: 'V5', title: 'Black Gold', volumeRequired: 2_000_000 * USD, withdrawalPriority: 4, instantAutoTransfer: true, proTrackerHud: true },
];

export const GRACE_PERIOD_DAYS = 30;

/** The tier a player's cumulative volume earns outright. */
export function tierForVolume(cumulativeVolume: number): VipTierSpec {
  let earned = VIP_TIERS[0]!;
  for (const t of VIP_TIERS) if (cumulativeVolume >= t.volumeRequired) earned = t;
  return earned;
}

function indexOf(tier: VipTier): number {
  return VIP_TIERS.findIndex((t) => t.tier === tier);
}

export interface VipState {
  currentTier: VipTier;
  /** When the player first fell below `currentTier`'s requirement, or null if they still meet it. */
  belowSince: number | null;
}

export function newVipState(): VipState {
  return { currentTier: 'V1', belowSince: null };
}

/**
 * Recompute a player's tier from their cumulative volume and the clock.
 *
 *  • At or above the current tier's requirement → upgrade immediately to whatever volume earns.
 *  • Below it → keep the tier through a 30-day grace period, then drop exactly ONE tier and reset
 *    the grace window (so a still-underqualified player steps down gradually, never to the floor).
 */
export function reconcileVip(state: VipState, cumulativeVolume: number, now: number): VipState {
  const earned = tierForVolume(cumulativeVolume);
  const earnedIdx = indexOf(earned.tier);
  const currentIdx = indexOf(state.currentTier);

  if (earnedIdx >= currentIdx) {
    // Meets or exceeds the current tier — immediate upgrade, grace cleared.
    return { currentTier: earned.tier, belowSince: null };
  }

  // Below the current tier: start (or continue) the grace window.
  const belowSince = state.belowSince ?? now;
  const graceMs = GRACE_PERIOD_DAYS * 86_400_000;
  if (now - belowSince < graceMs) {
    return { currentTier: state.currentTier, belowSince }; // privileges held during grace
  }

  // Grace expired → drop exactly one tier, never below what volume earns, and restart the window.
  const droppedIdx = Math.max(earnedIdx, currentIdx - 1);
  return { currentTier: VIP_TIERS[droppedIdx]!.tier, belowSince: now };
}

export function vipSpec(tier: VipTier): VipTierSpec {
  return VIP_TIERS[indexOf(tier)]!;
}

export interface VipProgress {
  tier: VipTier;
  title: string;
  next: { tier: VipTier; title: string; threshold: number; remaining: number } | null;
  /** 0–100, measured BETWEEN the two thresholds — a V4 most of the way to V5
   *  should not read 25% just because the scale starts at zero. */
  progressPct: number;
}

/** Tier + progress for a cumulative effective volume (micro-USD). One home for
 *  this arithmetic, beside the ladder it measures. */
/**
 * Estimated time to the next tier (§10.2: "'My VIP' page: real-time progress
 * bar + $X remaining to next tier + estimated upgrade time").
 *
 * Projected from THIS MONTH's effective volume, which is the only pace signal
 * that is already stored. Two guards, both there to avoid publishing a number
 * that is really noise:
 *
 *   - nothing is shown in the first few days of a month, when one good session
 *     projects to an absurd date;
 *   - nothing is shown at zero pace, because "never" is not an estimate.
 *
 * Returning null is a normal outcome, not a failure. A missing estimate is far
 * better than a confident wrong one — a player told they are eleven days from
 * Platinum will remember it, and will be right to be annoyed when it slips.
 */
export const MIN_DAYS_FOR_ESTIMATE = 5;

export function estimateDaysToNextTier(input: {
  /** micro-USD still needed for the next tier. */
  remaining: number;
  /** micro-USD of effective volume so far this calendar month. */
  monthlyEffective: number;
  /** How many days of this month have elapsed, including today. */
  daysElapsed: number;
}): number | null {
  if (input.remaining <= 0) return null;
  if (input.daysElapsed < MIN_DAYS_FOR_ESTIMATE) return null;
  if (input.monthlyEffective <= 0) return null;

  const perDay = input.monthlyEffective / input.daysElapsed;
  if (perDay <= 0) return null;

  return Math.ceil(input.remaining / perDay);
}

/** Days elapsed in the current UTC calendar month, including today. */
export const daysElapsedThisMonth = (at: Date): number => at.getUTCDate();

export function vipProgress(cumulativeVolume: number): VipProgress {
  const current = tierForVolume(cumulativeVolume);
  const nextSpec = VIP_TIERS[indexOf(current.tier) + 1] ?? null;
  const span = nextSpec ? nextSpec.volumeRequired - current.volumeRequired : 0;
  const pct = nextSpec && span > 0
    ? Math.min(100, Math.max(0, ((cumulativeVolume - current.volumeRequired) / span) * 100))
    : 100;
  return {
    tier: current.tier,
    title: current.title,
    next: nextSpec
      ? {
          tier: nextSpec.tier,
          title: nextSpec.title,
          threshold: nextSpec.volumeRequired,
          remaining: Math.max(0, nextSpec.volumeRequired - cumulativeVolume),
        }
      : null,
    progressPct: Number(pct.toFixed(1)),
  };
}
