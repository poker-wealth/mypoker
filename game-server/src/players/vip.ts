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

// Display titles (owner branding, Jul 15): clean ladder with an exclusive top tier. Internal ids
// stay V1–V5; only the labels changed — no thresholds or privileges moved.
export const VIP_TIERS: readonly VipTierSpec[] = [
  { tier: 'V1', title: 'Bronze', volumeRequired: 0, withdrawalPriority: 0, instantAutoTransfer: false, proTrackerHud: false },
  { tier: 'V2', title: 'Silver', volumeRequired: 10_000 * USD, withdrawalPriority: 1, instantAutoTransfer: false, proTrackerHud: false },
  { tier: 'V3', title: 'Gold', volumeRequired: 100_000 * USD, withdrawalPriority: 2, instantAutoTransfer: false, proTrackerHud: true },
  { tier: 'V4', title: 'Diamond', volumeRequired: 500_000 * USD, withdrawalPriority: 3, instantAutoTransfer: false, proTrackerHud: true },
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
