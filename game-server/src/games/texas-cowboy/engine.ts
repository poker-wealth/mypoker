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
  category: 'WINNER' | 'HAND_TYPE' | 'TIE';
  selection: string;
  multiplier: number;
  enabled: boolean;
}

/**
 * The published odds.
 *
 * These set how the pool is SHARED, not what the house guarantees — see `settleBets`. A 248x market
 * takes 248 times the share of a 1x market staked the same, which preserves the shape of the odds
 * board while keeping every round funded by the people betting in it.
 */
export const DEFAULT_MARKETS: BettingMarket[] = [
  // WINNER
  { id: 'cowboy_win', name: 'Cowboy Wins', category: 'WINNER', selection: 'COWBOY', multiplier: 2.02, enabled: true },
  { id: 'cowgirl_win', name: 'Cowgirl Wins', category: 'WINNER', selection: 'COWGIRL', multiplier: 2.02, enabled: true },
  { id: 'tie', name: 'Tie', category: 'TIE', selection: 'TIE', multiplier: 19.5, enabled: true },
  // HAND TYPE
  { id: 'high_card', name: 'High Card', category: 'HAND_TYPE', selection: 'HIGH_CARD', multiplier: 2.2, enabled: true },
  { id: 'one_pair', name: 'One Pair', category: 'HAND_TYPE', selection: 'ONE_PAIR', multiplier: 2.2, enabled: true },
  { id: 'two_pair', name: 'Two Pair', category: 'HAND_TYPE', selection: 'TWO_PAIR', multiplier: 3.1, enabled: true },
  { id: 'three_of_a_kind', name: 'Three of a Kind', category: 'HAND_TYPE', selection: 'THREE_OF_A_KIND', multiplier: 4.5, enabled: true },
  { id: 'straight', name: 'Straight', category: 'HAND_TYPE', selection: 'STRAIGHT', multiplier: 4.5, enabled: true },
  { id: 'flush', name: 'Flush', category: 'HAND_TYPE', selection: 'FLUSH', multiplier: 6.0, enabled: true },
  { id: 'full_house', name: 'Full House', category: 'HAND_TYPE', selection: 'FULL_HOUSE', multiplier: 20.0, enabled: true },
  { id: 'four_of_a_kind', name: 'Four of a Kind', category: 'HAND_TYPE', selection: 'FOUR_OF_A_KIND', multiplier: 248.0, enabled: true },
  { id: 'straight_flush', name: 'Straight Flush', category: 'HAND_TYPE', selection: 'STRAIGHT_FLUSH', multiplier: 248.0, enabled: true },
  { id: 'royal_flush', name: 'Royal Flush', category: 'HAND_TYPE', selection: 'ROYAL_FLUSH', multiplier: 248.0, enabled: true },
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
      selection: market.selection,
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
    if (market.category === 'WINNER') return market.selection === result.winner;
    if (market.category === 'TIE') return result.winner === 'TIE';
    return result.winner !== 'TIE' && market.selection === result.winningHandType;
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
