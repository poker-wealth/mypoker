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
export const VOLUME_COEFFICIENT_BPS: Record<string, number> = {
  texas: 10_000, // x1.0
  'short-deck': 10_000,
  omaha: 10_000,
  baccarat: 3_000, // x0.3
  'niu-niu': 5_000, // x0.5
};

/** Everything not named above: x0.4. */
export const DEFAULT_COEFFICIENT_BPS = 4_000;

/**
 * In BASIS POINTS, not a decimal multiplier — iron rule 7 is "all amounts
 * integer / Decimal128, no floats", and `staked * 0.3` is float arithmetic on
 * money however well it happens to behave. (It was tested across 200k values
 * and never drifted; the rule exists so that nobody has to run that test to
 * trust the number.) Basis points keep the whole calculation in integers, and
 * it is the same unit settlement already uses for rake and jackpot shares.
 */
export const coefficientBpsFor = (gameId: string): number =>
  VOLUME_COEFFICIENT_BPS[gameId] ?? DEFAULT_COEFFICIENT_BPS;

/** The decimal form, for display only — never for arithmetic on an amount. */
export const coefficientFor = (gameId: string): number => coefficientBpsFor(gameId) / 10_000;

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
  const effective = Math.floor((input.staked * coefficientBpsFor(input.gameId)) / 10_000);

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

/**
 * The volume FACTS — no tier, no progress.
 *
 * The VIP ladder (thresholds, titles, grace-period demotion) lives in
 * game-server/src/players/vip.ts and the gateway applies it. A copy of the
 * ladder previously lived here and its tier titles had already drifted from the
 * canonical module's (owner renamed them Jul 15; this file still had the spec's
 * originals) — the drift is why this file now carries facts only.
 */
export interface VolumeFacts {
  /** Cumulative effective volume, micro-USD. Permanent, never resets. */
  cumulativeEffective: number;
  /** This calendar month's effective volume, for retention. */
  monthlyEffective: number;
  breakdown: GameBreakdown[];
}

export async function getVolumeFacts(playerId: string, at: Date = new Date()): Promise<VolumeFacts> {
  const rows = await VolumeModel.find({ playerId }).lean();
  const thisMonth = monthKey(at);

  const cumulativeEffective = rows.reduce((sum, r) => sum + r.effective, 0);
  const monthlyEffective = rows
    .filter((r) => r.month === thisMonth)
    .reduce((sum, r) => sum + r.effective, 0);

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
    cumulativeEffective,
    monthlyEffective,
    breakdown: [...byGame.values()].sort((a, b) => b.effective - a.effective),
  };
}

/**
 * Platform-wide payout rates, per game (feature queue #12).
 *
 * PROJECT_PLAN line 47 splits this feature: the RATES are "published theoretical
 * + lifetime-actual rate with sample size", read from the server — this. The
 * on-chain RULE-COMMITMENT and per-round rule-version stamp are W11 chain work
 * and are not pretended at here.
 *
 * Actual = Σ won / Σ staked across every player, per game — the same rows the
 * VIP tracker writes at settlement, so the public rate and a player's own
 * breakdown can never come from different books. Sample size is rounds, so a
 * reader can judge how much the rate means.
 */
export interface GameRtp {
  gameId: string;
  /** Lifetime actual return, percent to 2dp, or null before any play. */
  actualRtp: string | null;
  /** Rounds behind the figure — the honesty qualifier. */
  sampleRounds: number;
  /** Documented theoretical rate, where a vendor has published one. */
  theoreticalRtp: string | null;
}

/** Vendor-documented theoretical rates. Slots' 96.8% is from the provider's
 *  paytable (game-server/src/games/slots/slots-provider.ts). P2P card games
 *  have no house RTP — the pot returns to players minus rake — so null. */
const THEORETICAL_RTP: Record<string, string> = { slots: '96.80' };

export async function getPublicRtp(): Promise<GameRtp[]> {
  const rows = await VolumeModel.aggregate<{
    _id: string;
    staked: number;
    won: number;
    rounds: number;
  }>([
    { $group: { _id: '$gameId', staked: { $sum: '$staked' }, won: { $sum: '$won' }, rounds: { $sum: '$rounds' } } },
    { $sort: { rounds: -1 } },
  ]);

  return rows.map((r) => ({
    gameId: r._id,
    actualRtp: r.staked > 0 ? ((r.won / r.staked) * 100).toFixed(2) : null,
    sampleRounds: r.rounds,
    theoreticalRtp: THEORETICAL_RTP[r._id] ?? null,
  }));
}
