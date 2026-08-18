import { createHash, createHmac, randomBytes } from 'node:crypto';
import { uint32Stream, uniformBelow } from '../../fairness/rng';
import {
  signResult,
  type RoundRequest,
  type SignedRoundResult,
  type ThirdPartyProvider,
} from '../third-party/adapter';

/**
 * SlotsProvider — a reference third-party slots game, living OUTSIDE the trust boundary.
 *
 * It is handed no Financial Core and no database: it can only compute reels and sign what the round
 * paid. ThirdPartyAdapter decides whether that claim ever becomes money.
 *
 * Provably fair: the provider commits to a session seed (publishes SHA256 of it) before any spin.
 * Each round's reels come from HMAC(sessionSeed, roundId), so once the seed is revealed a player can
 * recompute every spin of the session and confirm none of them were altered.
 */

export const SYMBOLS = ['CHERRY', 'BELL', 'STAR', 'SEVEN'] as const;
export type Symbol_ = (typeof SYMBOLS)[number];

/** Reel weights (out of 20). Rarer symbol → bigger payout. */
const WEIGHTS: Readonly<Record<Symbol_, number>> = { CHERRY: 10, BELL: 6, STAR: 3, SEVEN: 1 };
const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

/** Three-of-a-kind multipliers; two cherries returns the stake. RTP ≈ 96.8%. */
const TRIPLE: Readonly<Record<Symbol_, number>> = { CHERRY: 3, BELL: 6, STAR: 15, SEVEN: 40 };
const TWO_CHERRY = 1;
export const MAX_MULTIPLIER = TRIPLE.SEVEN;

/** Weighted symbol pick, drawn without modulo bias. */
function pickSymbol(rng: Generator<number>): Symbol_ {
  let n = uniformBelow(rng, TOTAL_WEIGHT);
  for (const s of SYMBOLS) {
    if (n < WEIGHTS[s]) return s;
    n -= WEIGHTS[s];
  }
  /* c8 ignore next */
  return 'CHERRY';
}

export type Reels = [Symbol_, Symbol_, Symbol_];

/** The three reels for a round — pure, deterministic, replayable from the revealed seed. */
export function spin(sessionSeed: string, roundId: string): Reels {
  const roundSeed = createHmac('sha256', sessionSeed).update(roundId).digest('hex');
  const rng = uint32Stream(roundSeed);
  return [pickSymbol(rng), pickSymbol(rng), pickSymbol(rng)];
}

/** Payout multiplier for a set of reels. */
export function multiplierOf(reels: Reels): number {
  const [a, b, c] = reels;
  if (a === b && b === c) return TRIPLE[a];
  const cherries = reels.filter((s) => s === 'CHERRY').length;
  return cherries === 2 ? TWO_CHERRY : 0;
}

export class SlotsProvider implements ThirdPartyProvider {
  readonly name = 'slots';
  private readonly sessionSeed: string;
  private readonly secret: string;

  constructor(secret: string, sessionSeed = randomBytes(32).toString('hex')) {
    this.secret = secret;
    this.sessionSeed = sessionSeed;
  }

  /** Published BEFORE any spin; the seed is revealed after the session so every spin can be checked. */
  commit(): string {
    return createHash('sha256').update(this.sessionSeed).digest('hex');
  }
  revealSeed(): string {
    return this.sessionSeed;
  }

  /**
   * The seed a single round was generated from — the same value `spin()` derives the reels from.
   *
   * Exposed for the jackpot draw. The room used to hand the jackpot `${roundId}:seed`, which any
   * player can reproduce from a round id, so a jackpot was predictable before it fired. This is
   * derived from the session seed, which stays secret until the session ends, so it is not.
   */
  roundSeed(roundId: string): string {
    return createHmac('sha256', this.sessionSeed).update(roundId).digest('hex');
  }

  async playRound(req: RoundRequest): Promise<SignedRoundResult> {
    const reels = spin(this.sessionSeed, req.roundId);
    const payout = req.wager * multiplierOf(reels);
    return {
      result: {
        roundId: req.roundId,
        payout,
        outcome: { reels, multiplier: multiplierOf(reels) },
        commit: this.commit(),
      },
      signature: signResult(this.secret, { ...req, payout }),
    };
  }
}
