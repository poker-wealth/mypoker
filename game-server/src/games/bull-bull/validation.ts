import type { Card } from './card';
import type { GamePhase, Player } from './engine';
import type { HandEvaluation } from './evaluator';
import type { Bet, Settlement } from './settlement';

/**
 * The rules an action has to pass before the engine will apply it.
 *
 * Kept as named functions rather than `if`s buried in the engine so they can be read on their own,
 * tested on their own, and reused by a server that has to reject the same actions arriving over a
 * wire. The engine calls every one of these; nothing here trusts a caller.
 */

export class BullBullValidationError extends Error {}

/** House limits, and which multipliers this table offers. All configurable per room. */
export interface TableLimits {
  minBet: number;
  maxBet: number;
  bankerBidOptions: number[];
  betMultiplierOptions: number[];
}

export const DEFAULT_LIMITS: TableLimits = {
  minBet: 100,
  maxBet: 10_000,
  bankerBidOptions: [1, 2, 5],
  betMultiplierOptions: [1, 2, 5],
};

function fail(message: string): never {
  throw new BullBullValidationError(message);
}

/** An action belongs to a phase. Betting during EVALUATION is not a late bet, it is a bug. */
export function validateGamePhase(actual: GamePhase, allowed: GamePhase[], action: string): void {
  if (!allowed.includes(actual)) {
    fail(`cannot ${action} during ${actual} — allowed in ${allowed.join(' or ')}`);
  }
}

export function validateBankerBid(multiplier: number, limits: TableLimits): void {
  if (!limits.bankerBidOptions.includes(multiplier)) {
    fail(`banker bid must be one of ${limits.bankerBidOptions.join('x, ')}x`);
  }
}

/**
 * What this bet can actually cost, which is NOT the amount written on it.
 *
 * A ₦1,000 bet at 5x against a 5x banker settles ₦25,000. Checking the face amount against the
 * balance is how a player with ₦1,000 ends a round at −₦24,000: the money still balances, but
 * nobody can pay. Exposure is the number every limit here is about.
 */
export function betExposure(amount: number, betMultiplier: number, bankerMultiplier: number): number {
  return amount * betMultiplier * bankerMultiplier;
}

/** What a player can still commit: their balance less anything already riding on this round. */
export function availableBalance(player: Player): number {
  return player.balance - player.reserved;
}

export function validatePlayerBalance(player: Player, exposure: number): void {
  if (availableBalance(player) < exposure) {
    fail(
      `${player.name} cannot cover ₦${exposure.toLocaleString()} — available ₦${availableBalance(
        player,
      ).toLocaleString()}`,
    );
  }
}

export interface BetContext {
  player: Player;
  banker: Player;
  bankerMultiplier: number;
  /** Exposure the banker already carries from the other players this round. */
  bankerCommitted: number;
  limits: TableLimits;
  /** The player's previous bet this round, if they are changing it. */
  previous?: Bet | undefined;
}

/**
 * Everything that has to be true for a bet to stand.
 *
 * Both sides have to be able to pay: the player for their own loss, and the BANKER for every
 * player's win at once. A bank that cannot cover the table is the same defect as a player who
 * cannot cover their bet — it just shows up as one big negative number instead of three small ones.
 */
export function validateBet(bet: Bet, ctx: BetContext): void {
  const { player, banker, limits } = ctx;

  if (player.isBanker) fail('the banker does not bet against themselves');
  if (!Number.isInteger(bet.amount)) fail('bet must be a whole number');
  if (bet.amount < limits.minBet) fail(`minimum bet is ₦${limits.minBet.toLocaleString()}`);
  if (bet.amount > limits.maxBet) fail(`maximum bet is ₦${limits.maxBet.toLocaleString()}`);
  if (!limits.betMultiplierOptions.includes(bet.multiplier)) {
    fail(`bet multiplier must be one of ${limits.betMultiplierOptions.join('x, ')}x`);
  }

  const exposure = betExposure(bet.amount, bet.multiplier, ctx.bankerMultiplier);
  validatePlayerBalance(player, exposure);

  // Replacing a bet frees what the old one was holding.
  const freed = ctx.previous
    ? betExposure(ctx.previous.amount, ctx.previous.multiplier, ctx.bankerMultiplier)
    : 0;
  const bankerExposure = ctx.bankerCommitted - freed + exposure;
  if (bankerExposure > banker.balance) {
    fail(
      `the bank cannot cover this table — ₦${bankerExposure.toLocaleString()} at risk against ` +
        `₦${banker.balance.toLocaleString()}`,
    );
  }
}

/** A dealt hand is exactly five distinct cards. */
export function validateHand(cards: Card[] | undefined, playerId: string): asserts cards is Card[] {
  if (!cards || cards.length !== 5) fail(`player ${playerId} was not dealt five cards`);
  if (new Set(cards.map((c) => c.id)).size !== 5) fail(`player ${playerId} holds duplicate cards`);
}

/**
 * The accounting invariant, checked before any balance is written: what the players win and lose
 * has to be exactly what the banker loses and wins. Anything else is money invented or destroyed.
 */
export function validateSettlement(settlements: Settlement[], bankerNetChange: number): void {
  const playerSum = settlements.reduce((sum, s) => sum + s.netChange, 0);
  if (playerSum + bankerNetChange !== 0) {
    fail(
      `settlement does not balance: players ${playerSum} + banker ${bankerNetChange} = ` +
        `${playerSum + bankerNetChange}, expected 0`,
    );
  }
}

/** Both sides of a settled round must have been evaluated. */
export function validateEvaluation(
  evaluation: HandEvaluation | undefined,
  playerId: string,
): asserts evaluation is HandEvaluation {
  if (!evaluation) fail(`no hand evaluation for player ${playerId}`);
}
