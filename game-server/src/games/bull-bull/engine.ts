import { type Card, createDeck, dealCards, shuffleDeck } from './card';
import { type HandEvaluation, evaluateHand } from './evaluator';
import {
  type BankerState,
  type Bet,
  type Settlement,
  calculatePayout,
  calculateSettlement,
} from './settlement';
import {
  DEFAULT_LIMITS,
  type TableLimits,
  availableBalance,
  betExposure,
  validateBankerBid,
  validateBet,
  validateEvaluation,
  validateGamePhase,
  validateHand,
  validateSettlement,
} from './validation';

export type GamePhase =
  | 'WAITING'
  | 'BANKER_SELECTION'
  | 'BETTING'
  | 'DEALING'
  | 'REVEAL'
  | 'EVALUATION'
  | 'RESULTS'
  | 'SETTLEMENT';

export interface Player {
  id: string;
  name: string;
  balance: number;
  /**
   * Money already riding on this round. Reserved when a bet is accepted and released at
   * settlement, so a second bet cannot commit chips the first one is already using.
   */
  reserved: number;
  isBanker: boolean;
}

export interface GameRoom {
  id: string;
  players: Player[];
  bankerState: BankerState | null;
  phase: GamePhase;
  deck: Card[];
  hands: Record<string, Card[]>;
  bets: Record<string, Bet>;
  evaluations: Record<string, HandEvaluation>;
  settlements: Settlement[];
  bankerNetChange: number;
  roundNumber: number;
  revealProgress: number; // 0..5
  limits: TableLimits;
}

/** Which of the tied top bidders takes the bank. Swappable; the default draws at random. */
export type BankerTieBreak = (tiedPlayerIds: string[], randomFn: () => number) => string;

export const randomTieBreak: BankerTieBreak = (tied, randomFn) =>
  tied[Math.floor(randomFn() * tied.length)]!;

/** First to bid the top multiplier keeps it — deterministic, for tables that prefer speed. */
export const firstBidderTieBreak: BankerTieBreak = (tied) => tied[0]!;

export interface EngineOptions {
  limits?: Partial<TableLimits>;
  bankerTieBreak?: BankerTieBreak;
}

/**
 * BullBullEngine — the authority on a four-seat Bull Bull round.
 *
 * One banker, three players, each compared against the bank on their own. Every rule lives here:
 * what a legal bet is, who can cover it, what the cards are worth, who won and what moves. The UI
 * renders what this says and decides nothing — `getRoomState()` hands out a copy for exactly that
 * reason, so a component cannot quietly adjust a balance.
 */
export class BullBullEngine {
  private room: GameRoom;
  private bankerBids = new Map<string, number>();
  private readonly tieBreak: BankerTieBreak;

  constructor(
    roomId = 'bull-bull-room-1',
    initialPlayers: { id: string; name: string; balance: number }[] = [],
    options: EngineOptions = {},
  ) {
    this.tieBreak = options.bankerTieBreak ?? randomTieBreak;
    this.room = {
      id: roomId,
      players: initialPlayers.map((p) => ({ ...p, reserved: 0, isBanker: false })),
      bankerState: null,
      phase: initialPlayers.length === 4 ? 'BANKER_SELECTION' : 'WAITING',
      deck: [],
      hands: {},
      bets: {},
      evaluations: {},
      settlements: [],
      bankerNetChange: 0,
      roundNumber: 0,
      revealProgress: 0,
      limits: { ...DEFAULT_LIMITS, ...options.limits },
    };
  }

  /**
   * The room as the outside world may read it — a copy, deliberately.
   *
   * Handing back the live object let a caller write `state.players[0].balance = 1e9` and have the
   * engine agree. The client renders this; it does not own it.
   */
  getRoomState(): GameRoom {
    return structuredClone(this.room);
  }

  /** What this player could still put at risk right now. */
  availableFor(playerId: string): number {
    return availableBalance(this.requirePlayer(playerId));
  }

  /** What the bank currently stands to pay out across every bet on the table. */
  bankerExposure(): number {
    const banker = this.room.players.find((p) => p.isBanker);
    return banker ? banker.reserved : 0;
  }

  addPlayer(id: string, name: string, balance: number): void {
    if (this.room.players.length >= 4) throw new Error('Room is full (max 4 players)');
    if (this.room.players.some((p) => p.id === id)) throw new Error('Player already in room');
    this.room.players.push({ id, name, balance, reserved: 0, isBanker: false });
    if (this.room.players.length === 4 && this.room.phase === 'WAITING') {
      this.room.phase = 'BANKER_SELECTION';
    }
  }

  // ── Banker selection ────────────────────────────────────────────────────────

  submitBankerBid(playerId: string, multiplier: number): void {
    validateGamePhase(this.room.phase, ['BANKER_SELECTION'], 'bid for the bank');
    this.requirePlayer(playerId);
    validateBankerBid(multiplier, this.room.limits);
    this.bankerBids.set(playerId, multiplier);
  }

  selectBanker(randomFn: () => number = Math.random): void {
    validateGamePhase(this.room.phase, ['BANKER_SELECTION'], 'select the banker');
    if (this.room.players.length !== 4) throw new Error('Requires exactly 4 players');

    // Nobody is forced to bid; not bidding is a bid of 1.
    for (const p of this.room.players) {
      if (!this.bankerBids.has(p.id)) this.bankerBids.set(p.id, 1);
    }

    let maxBid = -1;
    let topBidders: string[] = [];
    for (const p of this.room.players) {
      const bid = this.bankerBids.get(p.id)!;
      if (bid > maxBid) {
        maxBid = bid;
        topBidders = [p.id];
      } else if (bid === maxBid) {
        topBidders.push(p.id);
      }
    }

    const bankerId = this.tieBreak(topBidders, randomFn);
    for (const p of this.room.players) p.isBanker = p.id === bankerId;
    this.room.bankerState = { playerId: bankerId, multiplier: maxBid };
    this.room.phase = 'BETTING';
  }

  // ── Betting ─────────────────────────────────────────────────────────────────

  /**
   * Place (or replace) a bet, reserving what it could cost.
   *
   * The reservation is the EXPOSURE — stake × player multiplier × banker multiplier — not the
   * stake. Both the player and the bank have to be able to cover it, so a round can never settle
   * into a negative balance.
   */
  placeBet(playerId: string, amount: number, multiplier = 1): void {
    validateGamePhase(this.room.phase, ['BETTING'], 'place a bet');
    const player = this.requirePlayer(playerId);
    const bankerState = this.room.bankerState;
    if (!bankerState) throw new Error('No banker selected');
    const banker = this.requirePlayer(bankerState.playerId);

    const bet: Bet = { playerId, amount, multiplier };
    const previous = this.room.bets[playerId];

    validateBet(bet, {
      player,
      banker,
      bankerMultiplier: bankerState.multiplier,
      bankerCommitted: banker.reserved,
      limits: this.room.limits,
      previous,
    });

    // Swap the old reservation for the new one on both sides of the bet.
    const exposure = betExposure(amount, multiplier, bankerState.multiplier);
    const freed = previous
      ? betExposure(previous.amount, previous.multiplier, bankerState.multiplier)
      : 0;
    player.reserved += exposure - freed;
    banker.reserved += exposure - freed;

    this.room.bets[playerId] = bet;
  }

  // ── The round ───────────────────────────────────────────────────────────────

  deal(randomFn: () => number = Math.random): void {
    validateGamePhase(this.room.phase, ['BETTING'], 'deal');
    if (!this.room.bankerState) throw new Error('No banker selected');

    // Anyone who did not bet is dealt in at the table minimum, if they can cover it.
    for (const p of this.room.players) {
      if (p.isBanker || this.room.bets[p.id]) continue;
      try {
        this.placeBet(p.id, this.room.limits.minBet, 1);
      } catch {
        // Cannot cover the minimum — they sit this round out rather than bet money they lack.
      }
    }

    this.room.phase = 'DEALING';
    const deck = shuffleDeck(createDeck(), randomFn);
    const { hands, remaining } = dealCards(
      deck,
      this.room.players.map((p) => p.id),
    );
    this.room.hands = hands;
    this.room.deck = remaining;
    this.room.revealProgress = 0;
    this.room.phase = 'REVEAL';
  }

  setRevealProgress(progress: number): void {
    validateGamePhase(this.room.phase, ['REVEAL', 'EVALUATION'], 'reveal cards');
    this.room.revealProgress = Math.max(0, Math.min(5, progress));
    if (this.room.revealProgress === 5) this.room.phase = 'EVALUATION';
  }

  evaluate(): void {
    validateGamePhase(this.room.phase, ['REVEAL', 'EVALUATION'], 'evaluate hands');

    this.room.evaluations = {};
    for (const p of this.room.players) {
      const cards = this.room.hands[p.id];
      validateHand(cards, p.id);
      this.room.evaluations[p.id] = evaluateHand(cards);
    }

    this.room.phase = 'RESULTS';
  }

  /**
   * Settle every player against the bank, then write the balances.
   *
   * Nothing is written until the whole round balances: the settlements are computed, checked
   * against the invariant, and only then applied. A round that does not add up moves no money.
   */
  settle(): void {
    validateGamePhase(this.room.phase, ['RESULTS'], 'settle the round');
    const bankerState = this.room.bankerState;
    if (!bankerState) throw new Error('Missing banker state');

    const bankerEval = this.room.evaluations[bankerState.playerId];
    validateEvaluation(bankerEval, bankerState.playerId);

    const settlements: Settlement[] = [];
    let bankerNet = 0;

    for (const p of this.room.players) {
      if (p.isBanker) continue;
      const bet = this.room.bets[p.id];
      if (!bet) continue;
      const playerEval = this.room.evaluations[p.id];
      validateEvaluation(playerEval, p.id);

      const settlement = calculateSettlement(
        p.id,
        playerEval,
        bankerEval,
        bet,
        bankerState.multiplier,
      );
      settlements.push(settlement);
      bankerNet -= settlement.netChange;
    }

    validateSettlement(settlements, bankerNet);

    for (const settlement of settlements) {
      const player = this.requirePlayer(settlement.playerId);
      this.updateBalance(player, settlement.netChange);
      player.reserved = 0;
    }
    const banker = this.requirePlayer(bankerState.playerId);
    this.updateBalance(banker, bankerNet);
    banker.reserved = 0;

    this.room.settlements = settlements;
    this.room.bankerNetChange = bankerNet;
    this.room.phase = 'SETTLEMENT';
    this.room.roundNumber++;
  }

  /**
   * Move a balance. The only place a balance changes, and it refuses to go negative — with the
   * exposure checks at bet time this is unreachable, which is the point of asserting it.
   */
  private updateBalance(player: Player, delta: number): void {
    const next = player.balance + delta;
    if (next < 0) {
      throw new Error(
        `settlement would put ${player.name} at ${next} — exposure was not covered at bet time`,
      );
    }
    player.balance = next;
  }

  /** Clear the table for the next round. Balances and seats carry over; everything else resets. */
  nextRound(): void {
    validateGamePhase(this.room.phase, ['SETTLEMENT'], 'start the next round');
    this.resetRound();
    this.room.phase = 'BANKER_SELECTION';
  }

  /** Wipe the round's working state without touching balances. */
  resetRound(): void {
    this.bankerBids.clear();
    this.room.bankerState = null;
    this.room.hands = {};
    this.room.bets = {};
    this.room.evaluations = {};
    this.room.settlements = [];
    this.room.bankerNetChange = 0;
    this.room.revealProgress = 0;
    this.room.deck = [];
    for (const p of this.room.players) {
      p.isBanker = false;
      p.reserved = 0;
    }
  }

  private requirePlayer(playerId: string): Player {
    const player = this.room.players.find((p) => p.id === playerId);
    if (!player) throw new Error(`Player not found: ${playerId}`);
    return player;
  }
}

export { calculatePayout };
