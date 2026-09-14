import {
  type PokerHandType,
  type HandEvaluation,
  evaluateTexasCowboyHand,
  compareCowboyHands,
  createDeck,
  shuffleDeck,
  dealRound,
} from './poker';

export type GamePhase =
  | 'WAITING'
  | 'BETTING_OPEN'
  | 'BETTING_CLOSING'
  | 'BETTING_LOCKED'
  | 'DEALING'
  | 'FLOP_REVEAL'
  | 'TURN_REVEAL'
  | 'RIVER_REVEAL'
  | 'HAND_EVALUATION'
  | 'RESULTS'
  | 'PAYOUT'
  | 'ROUND_COMPLETE'
  | 'RESET';

export interface BettingWindow {
  openedAt: number;
  closesAt: number;
}

export interface BettingMarket {
  id: string;
  name: string;
  category: 'WINNER' | 'HAND_TYPE' | 'TIE' | 'HOLE';
  /**
   * What this market pays on.
   *
   * WINNER/TIE: the winner it backs. HAND_TYPE: ONE OR MORE hand types, any of
   * which wins it — the reference sells "Three of a kind / Straight / Flush" as
   * a single bet, and so do we. HOLE: the name of a hole-card test below.
   *
   * A LIST, not a string, because that difference is the whole of the pricing.
   * These markets were split one-per-hand-type while keeping the reference's
   * COMBINED prices, which quietly made every one of them a different bet from
   * the one the price was set for: 4.5x on three-of-a-kind alone is not 4.5x on
   * three-of-a-kind-or-straight-or-flush.
   */
  selections: string[];
  multiplier: number;
  enabled: boolean;
}

/**
 * The hole-card tests the reference's "Either hand type" band sells.
 *
 * These look at the two cards DEALT to each side, not at the five-card hand
 * they end up making — which is why they cannot be expressed as hand types.
 * Either side qualifying wins the market, hence "either".
 */
export type HoleTest = 'SUITED_OR_CONNECTED' | 'POCKET_PAIR' | 'POCKET_ACES';

/** Rank order for connectedness. Ace is high AND low, so A2 and AK both connect. */
const RANK_SEQUENCE = '23456789TJQKA';

/** `As` → `A`, `Th` → `T`. */
const rankOf = (card: string): string => card.slice(0, -1);
const suitOf = (card: string): string => card.slice(-1);

/**
 * Does this pair of hole cards pass the test?
 *
 * Exported for the tests: these three predicates decide real payouts at 1.66x,
 * 8.5x and 100x, and each is a one-line rule that is easy to get quietly wrong.
 */
export function holeQualifies(cards: readonly string[], test: HoleTest): boolean {
  if (cards.length < 2) return false;
  const [a, b] = cards as [string, string];
  const ra = rankOf(a);
  const rb = rankOf(b);

  if (test === 'POCKET_PAIR') return ra === rb;
  if (test === 'POCKET_ACES') return ra === 'A' && rb === 'A';

  // SUITED_OR_CONNECTED — either is enough, as the reference's
  // "Suited/Connects/Suited connects" says on its face.
  if (suitOf(a) === suitOf(b)) return true;
  const ia = RANK_SEQUENCE.indexOf(ra);
  const ib = RANK_SEQUENCE.indexOf(rb);
  if (ia < 0 || ib < 0) return false;
  const gap = Math.abs(ia - ib);
  // A-2 is a connector as well as A-K: the ace plays at both ends of the
  // sequence, so the wheel counts. Without this, one of the two ways an ace
  // connects silently never pays.
  return gap === 1 || (ra === 'A' || rb === 'A' ? gap === RANK_SEQUENCE.length - 1 : false);
}

/**
 * The published odds.
 *
 * These set how the pool is SHARED, not what the house guarantees — see `settleBets`. A 248x market
 * takes 248 times the share of a 1x market staked the same, which preserves the shape of the odds
 * board while keeping every round funded by the people betting in it.
 */
export const DEFAULT_MARKETS: BettingMarket[] = [
  // ── The duel ──────────────────────────────────────────────────────────────
  { id: 'cowboy_win', name: 'Cowboy Win', category: 'WINNER', selections: ['COWBOY'], multiplier: 2.02, enabled: true },
  { id: 'tie', name: 'Push', category: 'TIE', selections: ['TIE'], multiplier: 19.5, enabled: true },
  { id: 'cowgirl_win', name: 'Cowgirl Win', category: 'WINNER', selections: ['COWGIRL'], multiplier: 2.02, enabled: true },

  // ── Either hand type ──────────────────────────────────────────────────────
  // On the DEALT cards, not the finished hand. Either side qualifying pays.
  { id: 'suited_connects', name: 'Suited/Connects/Suited connects', category: 'HOLE', selections: ['SUITED_OR_CONNECTED'], multiplier: 1.66, enabled: true },
  { id: 'pocket_pair', name: 'Pair', category: 'HOLE', selections: ['POCKET_PAIR'], multiplier: 8.5, enabled: true },
  { id: 'pocket_aces', name: "Pair A's", category: 'HOLE', selections: ['POCKET_ACES'], multiplier: 100, enabled: true },

  // ── Winning hand rank ─────────────────────────────────────────────────────
  // COMBINED, as the reference sells them. Each price belongs to the whole
  // group; pricing one member at the group's odds is a different bet.
  { id: 'high_card_or_pair', name: 'High card/One pair', category: 'HAND_TYPE', selections: ['HIGH_CARD', 'ONE_PAIR'], multiplier: 2.2, enabled: true },
  { id: 'two_pair', name: 'Two pairs', category: 'HAND_TYPE', selections: ['TWO_PAIR'], multiplier: 3.1, enabled: true },
  { id: 'trips_straight_flush', name: 'Three of a kind/Straight/Flush', category: 'HAND_TYPE', selections: ['THREE_OF_A_KIND', 'STRAIGHT', 'FLUSH'], multiplier: 4.5, enabled: true },
  { id: 'full_house', name: 'Full House', category: 'HAND_TYPE', selections: ['FULL_HOUSE'], multiplier: 20, enabled: true },
  { id: 'quads_or_better', name: 'Four of a kind/Straight Flush/Royal Flush', category: 'HAND_TYPE', selections: ['FOUR_OF_A_KIND', 'STRAIGHT_FLUSH', 'ROYAL_FLUSH'], multiplier: 248, enabled: true },
];

export interface UserBet {
  id: string;
  userId: string;
  roundId: string;
  marketId: string;
  selection: string;
  amount: number;
  /** The odds as they stood when the bet was accepted. Never re-read from the market later. */
  multiplier: number;
  placedAt: number;
  status: 'ACTIVE' | 'WON' | 'LOST' | 'VOID';
  /** Stake back plus winnings. Zero on a loss, the stake on a void. */
  grossReturn?: number;
  /** What the balance actually moves by: `grossReturn - amount`. */
  netProfit?: number;
  /** Set when the client supplied one, so a retried request cannot double-stake. */
  idempotencyKey?: string;
}

export type Winner = 'COWBOY' | 'COWGIRL' | 'TIE';

/** What happens to hand-type bets when the hands tie. Configurable, per the brief. */
export type TieRule = 'HAND_TYPE_LOSES' | 'HAND_TYPE_VOIDS';

export interface TexasCowboyRound {
  id: string;
  roundNumber: number;
  phase: GamePhase;
  bettingWindow: BettingWindow | null;
  cowboy: { holeCards: string[]; evaluation: HandEvaluation | null };
  cowgirl: { holeCards: string[]; evaluation: HandEvaluation | null };
  communityCards: string[];
  markets: BettingMarket[];
  result: { winner: Winner; winningHandType: PokerHandType | null } | null;
  createdAt: number;
  settledAt: number | null;
}

export interface EngineOptions {
  markets?: BettingMarket[];
  tieRule?: TieRule;
  /** House cut, taken out of the winners' share at settlement. */
  rakeBps?: number;
}

/** What one round moved, per player. Zero-sum before rake — see `settleBets`. */
export interface RoundSettlement {
  /** playerId → net change in chips. Sums to exactly zero. */
  netByUser: Map<string, number>;
  bets: UserBet[];
  pool: number;
}

export class TexasCowboyEngine {
  private state: TexasCowboyRound;
  private userBets: UserBet[] = [];
  private readonly tieRule: TieRule;
  private settlement: RoundSettlement | null = null;

  constructor(roundId: string, roundNumber: number, options: EngineOptions = {}) {
    this.tieRule = options.tieRule ?? 'HAND_TYPE_LOSES';
    this.state = {
      id: roundId,
      roundNumber,
      phase: 'WAITING',
      bettingWindow: null,
      cowboy: { holeCards: [], evaluation: null },
      cowgirl: { holeCards: [], evaluation: null },
      communityCards: [],
      markets: options.markets ? [...options.markets] : [...DEFAULT_MARKETS],
      result: null,
      createdAt: Date.now(),
      settledAt: null,
    };
  }

  getRoundState(): TexasCowboyRound {
    return structuredClone(this.state);
  }

  getBets(): UserBet[] {
    return structuredClone(this.userBets);
  }

  /** What one player has staked so far this round. */
  stakedBy(userId: string): number {
    return this.userBets
      .filter((b) => b.userId === userId)
      .reduce((total, b) => total + b.amount, 0);
  }

  /**
   * Chips on each market, market id → total.
   *
   * Public: the board shows what the table is backing, the same way chips sit on a felt in front of
   * everyone. Pass a `userId` to get only that player's own stake instead.
   */
  poolByMarket(userId?: string): Record<string, number> {
    const pools: Record<string, number> = {};
    for (const bet of this.userBets) {
      if (userId !== undefined && bet.userId !== userId) continue;
      pools[bet.marketId] = (pools[bet.marketId] ?? 0) + bet.amount;
    }
    return pools;
  }

  openBetting(durationMs = 12_000, now = Date.now()): void {
    if (this.state.phase !== 'WAITING' && this.state.phase !== 'RESET') {
      throw new Error(`Cannot open betting from phase ${this.state.phase}`);
    }
    this.state.bettingWindow = { openedAt: now, closesAt: now + durationMs };
    this.state.phase = 'BETTING_OPEN';
  }

  /** The last seconds — still open, but the client should be shouting about it. */
  markClosing(): void {
    if (this.state.phase !== 'BETTING_OPEN') return;
    this.state.phase = 'BETTING_CLOSING';
  }

  lockBetting(): void {
    if (this.state.phase !== 'BETTING_OPEN' && this.state.phase !== 'BETTING_CLOSING') {
      throw new Error(`Cannot lock betting from phase ${this.state.phase}`);
    }
    this.state.phase = 'BETTING_LOCKED';
  }

  /**
   * Accept a bet, or refuse it with a reason.
   *
   * Refused when the window has closed by the SERVER's clock, when the market is unknown or off,
   * and when the player has not got the chips: `available` is what the caller says they can still
   * commit, and everything already staked this round counts against it.
   */
  placeBet(params: {
    userId: string;
    marketId: string;
    amount: number;
    available: number;
    serverTime?: number;
    generateId: () => string;
    idempotencyKey?: string;
  }): UserBet {
    const serverTime = params.serverTime ?? Date.now();

    // A retried request is the same bet, not another one.
    if (params.idempotencyKey) {
      const existing = this.userBets.find((b) => b.idempotencyKey === params.idempotencyKey);
      if (existing) return { ...existing };
    }

    if (this.state.phase !== 'BETTING_OPEN' && this.state.phase !== 'BETTING_CLOSING') {
      throw new Error(`BET_REJECTED: Phase is ${this.state.phase}`);
    }
    if (!this.state.bettingWindow || serverTime >= this.state.bettingWindow.closesAt) {
      throw new Error('BET_REJECTED: BETTING_CLOSED');
    }
    if (!Number.isInteger(params.amount) || params.amount <= 0) {
      throw new Error('BET_REJECTED: AMOUNT_INVALID');
    }

    const market = this.state.markets.find((m) => m.id === params.marketId);
    if (!market || !market.enabled) {
      throw new Error(`BET_REJECTED: Market ${params.marketId} not found or disabled`);
    }
    if (params.amount > params.available) {
      throw new Error('BET_REJECTED: INSUFFICIENT_CHIPS');
    }

    const bet: UserBet = {
      id: params.generateId(),
      userId: params.userId,
      roundId: this.state.id,
      marketId: params.marketId,
      // What the bet was placed ON, recorded as it stood. A grouped market
      // joins its selections so the slip reads the same as the board did.
      selection: market.selections.join('/'),
      amount: params.amount,
      multiplier: market.multiplier,
      placedAt: serverTime,
      status: 'ACTIVE',
      ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
    };

    this.userBets.push(bet);
    return { ...bet };
  }

  /**
   * Shuffle and deal. A caller may hand in a deck instead — the only way to pin a round in a test,
   * since the state this returns is a copy and cannot be rigged after the fact.
   */
  deal(options: { deck?: string[]; randomFn?: () => number } = {}): void {
    if (this.state.phase !== 'BETTING_LOCKED') {
      throw new Error(`Cannot deal from phase ${this.state.phase}`);
    }
    this.state.phase = 'DEALING';
    const deck = options.deck ? [...options.deck] : shuffleDeck(createDeck(), options.randomFn);
    const dealt = dealRound(deck);

    this.state.cowboy.holeCards = dealt.cowboyHole;
    this.state.cowgirl.holeCards = dealt.cowgirlHole;
    this.state.communityCards = dealt.community;
  }

  revealFlop(): void {
    if (this.state.phase !== 'DEALING') throw new Error('Invalid phase');
    this.state.phase = 'FLOP_REVEAL';
  }

  revealTurn(): void {
    if (this.state.phase !== 'FLOP_REVEAL') throw new Error('Invalid phase');
    this.state.phase = 'TURN_REVEAL';
  }

  revealRiver(): void {
    if (this.state.phase !== 'TURN_REVEAL') throw new Error('Invalid phase');
    this.state.phase = 'RIVER_REVEAL';
  }

  evaluateHands(): void {
    if (this.state.phase !== 'RIVER_REVEAL') throw new Error('Invalid phase');
    this.state.phase = 'HAND_EVALUATION';

    const cowboy = evaluateTexasCowboyHand([...this.state.cowboy.holeCards, ...this.state.communityCards]);
    const cowgirl = evaluateTexasCowboyHand([...this.state.cowgirl.holeCards, ...this.state.communityCards]);
    this.state.cowboy.evaluation = cowboy;
    this.state.cowgirl.evaluation = cowgirl;

    const outcome = compareCowboyHands(cowboy, cowgirl);
    this.state.result = {
      winner: outcome === 'COWBOY_WIN' ? 'COWBOY' : outcome === 'COWGIRL_WIN' ? 'COWGIRL' : 'TIE',
      winningHandType:
        outcome === 'COWBOY_WIN' ? cowboy.type : outcome === 'COWGIRL_WIN' ? cowgirl.type : null,
    };

    this.state.phase = 'RESULTS';
  }

  /**
   * Settle the round — PLAYER-FUNDED, and zero-sum before rake.
   *
   * There is no banker in this game, so fixed odds would make the platform the counterparty to
   * every bet: a 248x hit would be paid out of the house's pocket, which is the one thing that
   * blocks a merge here. Instead the losing stakes ARE the prize: winners take the losing pool,
   * shared in proportion to `stake × multiplier`, so the odds board still decides who gets the
   * bigger slice while every naira paid out came from a naira staked.
   *
   * Nobody wins → everything is voided rather than swept up, since there is no house to sweep it.
   * Idempotent: settling twice returns the first settlement and moves nothing.
   */
  settleBets(): RoundSettlement {
    if (this.settlement) return this.settlement;
    if (this.state.phase !== 'RESULTS') throw new Error('Invalid phase');
    const result = this.state.result;
    if (!result) throw new Error('No result to settle against');

    this.state.phase = 'PAYOUT';

    const winning = this.userBets.filter((bet) => this.betWins(bet, result));
    const voided = this.userBets.filter((bet) => this.betVoids(bet, result));
    const losing = this.userBets.filter(
      (bet) => !winning.includes(bet) && !voided.includes(bet),
    );

    const netByUser = new Map<string, number>();
    const add = (userId: string, delta: number): void =>
      void netByUser.set(userId, (netByUser.get(userId) ?? 0) + delta);

    for (const bet of voided) {
      bet.status = 'VOID';
      bet.grossReturn = bet.amount;
      bet.netProfit = 0;
    }

    const pool = losing.reduce((sum, bet) => sum + bet.amount, 0);

    if (winning.length === 0) {
      // No winners: the pool has nowhere to go that is not the house, so nobody loses either.
      for (const bet of [...losing, ...winning]) {
        bet.status = 'VOID';
        bet.grossReturn = bet.amount;
        bet.netProfit = 0;
      }
      this.settlement = { netByUser, bets: this.getBets(), pool: 0 };
      this.finishSettlement();
      return this.settlement;
    }

    for (const bet of losing) {
      bet.status = 'LOST';
      bet.grossReturn = 0;
      bet.netProfit = -bet.amount;
      add(bet.userId, -bet.amount);
    }

    // Share the pool by stake × odds, then hand the rounding remainder to the largest share so the
    // payouts add up to the pool exactly — integer chips, nothing invented, nothing lost.
    const weights = winning.map((bet) => bet.amount * bet.multiplier);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let distributed = 0;
    const profits = winning.map((_, i) => {
      const share = Math.floor((pool * weights[i]!) / totalWeight);
      distributed += share;
      return share;
    });
    if (profits.length > 0) {
      const biggest = weights.indexOf(Math.max(...weights));
      profits[biggest] = profits[biggest]! + (pool - distributed);
    }

    winning.forEach((bet, i) => {
      const profit = profits[i]!;
      bet.status = 'WON';
      bet.grossReturn = bet.amount + profit;
      bet.netProfit = profit;
      add(bet.userId, profit);
    });

    this.settlement = { netByUser, bets: this.getBets(), pool };
    this.finishSettlement();
    return this.settlement;
  }

  private finishSettlement(): void {
    this.state.settledAt = Date.now();
    this.state.phase = 'ROUND_COMPLETE';
  }

  private betWins(bet: UserBet, result: NonNullable<TexasCowboyRound['result']>): boolean {
    const market = this.state.markets.find((m) => m.id === bet.marketId);
    if (!market) return false;
    if (market.category === 'WINNER') return market.selections.includes(result.winner);
    if (market.category === 'TIE') return result.winner === 'TIE';

    /*
     * HOLE markets read the cards that were DEALT, and either side qualifying
     * pays — that is what the reference's "Either hand type" band means.
     *
     * They are settled independently of who won, and are NOT voided by a tie:
     * whether a hand was dealt suited is a fact about the deal, and a tie does
     * not un-deal it. The tie rule below applies to hand-type markets only,
     * which is why this returns before reaching it.
     */
    if (market.category === 'HOLE') {
      const test = market.selections[0] as HoleTest | undefined;
      if (!test) return false;
      return (
        holeQualifies(this.state.cowboy.holeCards, test) ||
        holeQualifies(this.state.cowgirl.holeCards, test)
      );
    }

    // HAND_TYPE — ANY of the market's types wins it, because the reference
    // sells them grouped and the price belongs to the group.
    return (
      result.winner !== 'TIE' &&
      result.winningHandType !== null &&
      market.selections.includes(result.winningHandType)
    );
  }

  private betVoids(bet: UserBet, result: NonNullable<TexasCowboyRound['result']>): boolean {
    const market = this.state.markets.find((m) => m.id === bet.marketId);
    if (!market) return true; // a market that no longer exists cannot be judged
    return (
      this.tieRule === 'HAND_TYPE_VOIDS' &&
      result.winner === 'TIE' &&
      market.category === 'HAND_TYPE'
    );
  }

  /** Clear the table for the next round. Bets and cards go; the markets stay. */
  resetRound(roundId: string, roundNumber: number): void {
    this.state = {
      ...this.state,
      id: roundId,
      roundNumber,
      phase: 'RESET',
      bettingWindow: null,
      cowboy: { holeCards: [], evaluation: null },
      cowgirl: { holeCards: [], evaluation: null },
      communityCards: [],
      result: null,
      createdAt: Date.now(),
      settledAt: null,
    };
    this.userBets = [];
    this.settlement = null;
  }
}
