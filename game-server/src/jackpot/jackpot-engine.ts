import {
  dailyTriggerAt,
  grandTriggerAt,
  isInGrandWindow,
  nextRoundInterval,
  zoned,
} from './schedule';
import {
  injectionFor,
  splitInjection,
  TIER_CONFIG,
  TIERS,
  type JackpotTier,
} from './tiers';
import { drawWinner, type JackpotCandidate } from './weights';

/**
 * JackpotEngine — one table's four pools, their triggers and their history (v5.9 §5).
 *
 * Money in:  0.5% of the WINNER'S PROFIT, split 20/30/25/25. Losers never fund a jackpot.
 * Money out: a share of that table's own pool (Mini 5% / Minor 15% / Major 40% / Grand 70%),
 *            to a weighted winner, and only once the pool clears its minimum.
 *
 * Three rules from the spec that are easy to get wrong, so they are enforced here explicitly:
 *
 *  • Below threshold → SKIP, and the counter keeps accumulating. We do not subsidise the pool from
 *    platform money and we do not defer the payout: the tier simply stays due and fires the moment
 *    the pool is genuinely funded.
 *  • Grand needs all THREE conditions at once — pool ≥ $1,000 AND players at the table AND inside
 *    the Saturday window. A table frozen during its window misses it and waits for next Saturday.
 *  • CB3 — three jackpots inside one hour on the same table freezes that table's jackpot. That is a
 *    farming signature, not luck.
 */

export interface RoundContext {
  roundId: string;
  /** The round's final seed (server + client seeds + future block) — makes every draw verifiable. */
  seed: string;
  now: number;
  /** Everyone seated, with their anti-bot / collusion status. */
  candidates: readonly JackpotCandidate[];
}

export interface JackpotHit {
  tier: JackpotTier;
  playerId: string;
  amount: number;
  roundId: string;
  at: number;
  /** Pool balance after paying out. */
  poolAfter: number;
  animationMs: number;
  seed: string;
}

export type SkipReason =
  | 'BELOW_THRESHOLD'
  | 'NO_PLAYERS'
  | 'OUTSIDE_WINDOW'
  | 'TABLE_FROZEN'
  | 'NO_ELIGIBLE_WINNER';

export interface JackpotSkip {
  tier: JackpotTier;
  reason: SkipReason;
  at: number;
  poolAtSkip: number;
}

/** CB3: three jackpot hits within this window on one table freezes it. */
export const CB3_MAX_HITS = 3;
export const CB3_WINDOW_MS = 3_600_000;

export class JackpotEngine {
  private readonly pools: Record<JackpotTier, number> = { MINI: 0, MINOR: 0, MAJOR: 0, GRAND: 0 };
  /** Rounds played since each round-based tier last paid. */
  private readonly roundsSince: Record<JackpotTier, number> = { MINI: 0, MINOR: 0, MAJOR: 0, GRAND: 0 };
  /** The interval each round-based tier is currently counting towards (drawn from a seed). */
  private readonly target: Record<JackpotTier, number | null> = {
    MINI: null,
    MINOR: null,
    MAJOR: null,
    GRAND: null,
  };
  /** Period keys already paid, so Major fires at most once a day and Grand once a Saturday. */
  private readonly paidPeriod: Record<JackpotTier, string | null> = {
    MINI: null,
    MINOR: null,
    MAJOR: null,
    GRAND: null,
  };
  private epoch = 0;
  private frozen = false;
  private readonly hits: JackpotHit[] = [];
  private readonly skips: JackpotSkip[] = [];

  constructor(readonly tableId: string) {}

  // ── Money in ────────────────────────────────────────────────────────────────
  /** Inject 0.5% of the winner's profit, split across the four tiers. Returns what was injected. */
  inject(winnerProfit: number): { total: number; split: Record<JackpotTier, number> } {
    const total = injectionFor(winnerProfit);
    const split = splitInjection(total);
    for (const t of TIERS) this.pools[t] += split[t];
    return { total, split };
  }

  pool(tier: JackpotTier): number {
    return this.pools[tier];
  }
  totalPool(): number {
    return TIERS.reduce((a, t) => a + this.pools[t], 0);
  }

  // ── CB3 ─────────────────────────────────────────────────────────────────────
  isFrozen(): boolean {
    return this.frozen;
  }
  /** Ops action after review — CB3 freezes automatically, but only a human unfreezes. */
  unfreeze(): void {
    this.frozen = false;
  }
  private checkCB3(now: number): void {
    if (this.triggersLastHour(now) >= CB3_MAX_HITS) this.frozen = true;
  }

  /**
   * The live feed for the Financial Core's CB3 (`evaluateCB3(tableId, triggersLastHour)`).
   * Three jackpots in an hour on one table is a farming signature, not luck.
   */
  triggersLastHour(now: number): number {
    return this.hits.filter((h) => now - h.at < CB3_WINDOW_MS).length;
  }

  // ── Money out ───────────────────────────────────────────────────────────────
  /**
   * Advance one settled round and pay out any tier that is due.
   * Returns every hit (usually none) — the caller moves the money via the Financial Core.
   */
  onRoundSettled(ctx: RoundContext): JackpotHit[] {
    this.roundsSince.MINI += 1;
    this.roundsSince.MINOR += 1;

    const hits: JackpotHit[] = [];
    for (const tier of TIERS) {
      const hit = this.evaluate(tier, ctx);
      if (hit) {
        hits.push(hit);
        this.checkCB3(ctx.now); // three in an hour → this table's jackpot freezes
      }
    }
    return hits;
  }

  private evaluate(tier: JackpotTier, ctx: RoundContext): JackpotHit | null {
    const cfg = TIER_CONFIG[tier];

    // A frozen table pays nothing at all (CB3). Grand additionally misses its whole window.
    if (this.frozen) {
      if (this.isDue(tier, ctx)) this.skip(tier, 'TABLE_FROZEN', ctx.now);
      return null;
    }
    if (!this.isDue(tier, ctx)) return null;

    // Grand's three-condition gate — all three, simultaneously.
    if (tier === 'GRAND') {
      if (!isInGrandWindow(ctx.now)) {
        this.skip(tier, 'OUTSIDE_WINDOW', ctx.now);
        return null;
      }
      if (ctx.candidates.length === 0) {
        this.skip(tier, 'NO_PLAYERS', ctx.now);
        return null;
      }
    }

    // Below the minimum → skip. No subsidy, no deferral; the counter keeps accumulating and the
    // tier stays due, so it fires as soon as the pool is genuinely funded.
    if (this.pools[tier] < cfg.minThreshold) {
      this.skip(tier, 'BELOW_THRESHOLD', ctx.now);
      return null;
    }

    const winner = drawWinner(ctx.candidates, `${ctx.seed}:${tier}`);
    if (!winner) {
      // Everyone at the table is a confirmed colluder (weight 0) — pay nobody.
      this.skip(tier, 'NO_ELIGIBLE_WINNER', ctx.now);
      return null;
    }

    const amount = Math.floor((this.pools[tier] * cfg.payoutBps) / 10000);
    this.pools[tier] -= amount;
    this.reset(tier, ctx);

    const hit: JackpotHit = {
      tier,
      playerId: winner.playerId,
      amount,
      roundId: ctx.roundId,
      at: ctx.now,
      poolAfter: this.pools[tier],
      animationMs: cfg.animationMs,
      seed: ctx.seed,
    };
    this.hits.push(hit);
    return hit;
  }

  private isDue(tier: JackpotTier, ctx: RoundContext): boolean {
    const cadence = TIER_CONFIG[tier].cadence;

    if (cadence.kind === 'ROUNDS') {
      if (this.target[tier] === null) {
        this.target[tier] = nextRoundInterval(ctx.seed, tier, this.epoch);
      }
      return this.roundsSince[tier] >= this.target[tier]!;
    }

    if (cadence.kind === 'DAILY') {
      const dayKey = zoned(ctx.now).dayKey;
      if (this.paidPeriod.MAJOR === dayKey) return false; // once a day
      return ctx.now >= dailyTriggerAt(ctx.seed, ctx.now);
    }

    // WINDOW (Grand): due once the seed-chosen moment inside this Saturday's window has passed.
    const weekKey = zoned(ctx.now).dayKey;
    if (this.paidPeriod.GRAND === weekKey) return false;
    if (!isInGrandWindow(ctx.now)) return false;
    return ctx.now >= grandTriggerAt(ctx.seed, ctx.now);
  }

  private reset(tier: JackpotTier, ctx: RoundContext): void {
    const cadence = TIER_CONFIG[tier].cadence;
    if (cadence.kind === 'ROUNDS') {
      this.roundsSince[tier] = 0;
      this.epoch += 1;
      this.target[tier] = nextRoundInterval(ctx.seed, tier, this.epoch); // fresh unpredictable interval
    } else {
      this.paidPeriod[tier] = zoned(ctx.now).dayKey;
    }
  }

  private skip(tier: JackpotTier, reason: SkipReason, at: number): void {
    this.skips.push({ tier, reason, at, poolAtSkip: this.pools[tier] });
  }

  // ── History (spec: no time limit, fully queryable) ───────────────────────────
  history(filter: { tier?: JackpotTier; from?: number; to?: number; playerId?: string } = {}): JackpotHit[] {
    return this.hits.filter(
      (h) =>
        (!filter.tier || h.tier === filter.tier) &&
        (filter.from === undefined || h.at >= filter.from) &&
        (filter.to === undefined || h.at <= filter.to) &&
        (!filter.playerId || h.playerId === filter.playerId),
    );
  }

  skipHistory(): readonly JackpotSkip[] {
    return this.skips;
  }
}
