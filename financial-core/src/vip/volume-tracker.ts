import { Schema, model } from 'mongoose';

/**
 * Per-game play volume, and the VIP standing derived from it.
 *
 * Written by settlement when a hand settles, because that is the only moment
 * anything knows which game a round belonged to. The money ledger records the
 * movement, not the game — deliberately, and the spec's own wording says this
 * should be a tracker rather than a derivation: "Baccarat hand rake $10 → VIP
 * progress LOGS $3 (×0.3)", "cumulative volume TRACKING", "monthly volume
 * TRACKING".
 *
 * So nothing here touches the money path. This is a counter that sits beside it,
 * the same shape as reputation, settings and notifications.
 *
 * The coefficient is applied at WRITE time and the effective figure stored. A
 * raw total plus a coefficient applied on read would give a different answer the
 * moment a coefficient changed, silently restating history and moving players
 * between tiers who had done nothing.
 */

/**
 * Effective-volume coefficients (FairPlay_v5.9_FINAL_EN §10.2).
 *
 *   Texas ×1.0 / Baccarat ×0.3 / Niu Niu ×0.5 / Others ×0.4
 *
 * The spec states the reason plainly: it "prevents gaming with low-rake games".
 * Counting raw volume would let a player grind Baccarat to V5 — priority
 * withdrawal, instant auto-transfer — at a third of the intended cost.
 */
export const VOLUME_COEFFICIENT: Record<string, number> = {
  texas: 1.0,
  'short-deck': 1.0,
  omaha: 1.0,
  baccarat: 0.3,
  'niu-niu': 0.5,
};

/** Everything not named above. */
export const DEFAULT_COEFFICIENT = 0.4;

export const coefficientFor = (gameId: string): number =>
  VOLUME_COEFFICIENT[gameId] ?? DEFAULT_COEFFICIENT;

export type VipTier = 'V1' | 'V2' | 'V3' | 'V4' | 'V5';

export interface TierSpec {
  tier: VipTier;
  title: string;
  /** Cumulative effective volume required, micro-USD. */
  threshold: number;
}

/** Thresholds exactly as FairPlay_v5.9_FINAL_EN §10.2 tabulates them. */
export const TIERS: readonly TierSpec[] = [
  { tier: 'V1', title: 'Wanderer', threshold: 0 },
  { tier: 'V2', title: 'Rising Star', threshold: 10_000_000_000 }, // $10,000
  { tier: 'V3', title: 'Gold', threshold: 100_000_000_000 }, // $100,000
  { tier: 'V4', title: 'Platinum', threshold: 500_000_000_000 }, // $500,000
  { tier: 'V5', title: 'Black Gold', threshold: 2_000_000_000_000 }, // $2,000,000
];

export function tierFor(cumulativeEffective: number): TierSpec {
  // Walk down so the highest satisfied threshold wins.
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (cumulativeEffective >= TIERS[i]!.threshold) return TIERS[i]!;
  }
  return TIERS[0]!;
}

interface VolumeDoc {
  /** `${playerId}:${gameId}:${month}` — month is YYYY-MM, so monthly retention
   *  tracking and lifetime totals come from the same rows. */
  _id: string;
  playerId: string;
  gameId: string;
  month: string;
  rounds: number;
  /** micro-USD, raw stake. */
  staked: number;
  /** micro-USD, returned to the player. */
  won: number;
  /** micro-USD, staked × the game's coefficient — already weighted. */
  effective: number;
}

const schema = new Schema<VolumeDoc>(
  {
    _id: { type: String, required: true },
    playerId: { type: String, required: true, index: true },
    gameId: { type: String, required: true },
    month: { type: String, required: true, index: true },
    rounds: { type: Number, default: 0 },
    staked: { type: Number, default: 0 },
    won: { type: Number, default: 0 },
    effective: { type: Number, default: 0 },
  },
  { collection: 'player_game_volume' },
);

export const VolumeModel = model<VolumeDoc>('PlayerGameVolume', schema);

/** YYYY-MM in UTC. Same reasoning as the stats period: a boundary that shifts
 *  per request is worse than one that is consistently explainable. */
export const monthKey = (at: Date): string =>
  `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * Record a settled round's volume for one player.
 *
 * Increments rather than upserting a whole document, so concurrent settlements
 * on different tables cannot lose each other's writes.
 */
export async function recordVolume(input: {
  playerId: string;
  gameId: string;
  /** micro-USD staked by this player in this round. */
  staked: number;
  /** micro-USD returned to them. */
  won: number;
  at?: Date;
}): Promise<void> {
  if (input.staked <= 0) return;

  const month = monthKey(input.at ?? new Date());
  const effective = Math.floor(input.staked * coefficientFor(input.gameId));

  await VolumeModel.updateOne(
    { _id: `${input.playerId}:${input.gameId}:${month}` },
    {
      $setOnInsert: { playerId: input.playerId, gameId: input.gameId, month },
      $inc: { rounds: 1, staked: input.staked, won: input.won, effective },
    },
    { upsert: true },
  );
}

export interface GameBreakdown {
  gameId: string;
  rounds: number;
  staked: number;
  won: number;
  effective: number;
  /** Actual return to player for this game, as a percentage string, or null
   *  when nothing has been staked. */
  actualRtp: string | null;
}

export interface VipStanding {
  tier: VipTier;
  title: string;
  /** Cumulative effective volume, micro-USD. Permanent, never resets. */
  cumulativeEffective: number;
  /** This calendar month's effective volume, for retention. */
  monthlyEffective: number;
  next: { tier: VipTier; title: string; threshold: number; remaining: number } | null;
  /** 0–100, progress from the current threshold to the next. */
  progressPct: number;
  breakdown: GameBreakdown[];
}

export async function getVipStanding(playerId: string, at: Date = new Date()): Promise<VipStanding> {
  const rows = await VolumeModel.find({ playerId }).lean();
  const thisMonth = monthKey(at);

  const cumulativeEffective = rows.reduce((sum, r) => sum + r.effective, 0);
  const monthlyEffective = rows
    .filter((r) => r.month === thisMonth)
    .reduce((sum, r) => sum + r.effective, 0);

  const current = tierFor(cumulativeEffective);
  const currentIndex = TIERS.findIndex((t) => t.tier === current.tier);
  const nextSpec = TIERS[currentIndex + 1] ?? null;

  // Progress is measured between the two thresholds, not from zero — otherwise a
  // V4 shows 25% while being most of the way to V5.
  const span = nextSpec ? nextSpec.threshold - current.threshold : 0;
  const progressPct =
    nextSpec && span > 0
      ? Math.min(100, Math.max(0, ((cumulativeEffective - current.threshold) / span) * 100))
      : 100;

  // Collapse the monthly rows into one entry per game.
  const byGame = new Map<string, GameBreakdown>();
  for (const r of rows) {
    const existing = byGame.get(r.gameId) ?? {
      gameId: r.gameId,
      rounds: 0,
      staked: 0,
      won: 0,
      effective: 0,
      actualRtp: null,
    };
    existing.rounds += r.rounds;
    existing.staked += r.staked;
    existing.won += r.won;
    existing.effective += r.effective;
    byGame.set(r.gameId, existing);
  }
  for (const entry of byGame.values()) {
    entry.actualRtp = entry.staked > 0 ? ((entry.won / entry.staked) * 100).toFixed(2) : null;
  }

  return {
    tier: current.tier,
    title: current.title,
    cumulativeEffective,
    monthlyEffective,
    next: nextSpec
      ? {
          tier: nextSpec.tier,
          title: nextSpec.title,
          threshold: nextSpec.threshold,
          remaining: Math.max(0, nextSpec.threshold - cumulativeEffective),
        }
      : null,
    progressPct: Number(progressPct.toFixed(1)),
    breakdown: [...byGame.values()].sort((a, b) => b.effective - a.effective),
  };
}
