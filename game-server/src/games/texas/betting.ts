/**
 * Texas Hold'em betting engine.
 *
 * Drives a hand through its four betting rounds (preflop → flop → turn → river → showdown):
 * posts blinds, enforces turn order and min-raise rules, validates every action, and tracks each
 * player's contribution (which the side-pot builder uses at settlement). Works in integer chip
 * units; real money is handled by the Financial Core at buy-in and settlement.
 */

export type Street = 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';
export type SeatStatus = 'active' | 'folded' | 'allin';
export type ActionType = 'fold' | 'check' | 'call' | 'raise';

export interface Action {
  type: ActionType;
  /** For 'raise': the TOTAL this player wants their street contribution to be (raise-to). */
  amount?: number;
}

export interface SeatPublic {
  id: string;
  stack: number;
  status: SeatStatus;
  streetContributed: number;
  totalContributed: number;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  /** Chips needed to call, or null if nothing to call. */
  callAmount: number | null;
  /** Smallest legal raise-to, or null if a raise isn't possible. */
  minRaiseTo: number | null;
  /** Largest LEGAL raise-to. Under POT_LIMIT this is the pot cap, not the stack. */
  maxRaiseTo: number | null;
  /**
   * The raise-to that would actually put this seat all-in — everything in
   * front of them plus everything behind.
   *
   * Under NO_LIMIT it equals `maxRaiseTo`, which is why one field sufficed
   * before. Under POT_LIMIT the cap usually sits BELOW the stack, so asking
   * "is this all-in?" of `maxRaiseTo` calls every pot-sized raise an all-in.
   * Null only when there is nobody to act.
   */
  allInRaiseTo: number | null;
}

/**
 * How big a raise may be.
 *
 * NO_LIMIT — any amount up to the player's whole stack. Hold'em and Short Deck.
 * POT_LIMIT — capped at the size of the pot AFTER the raiser has called, which
 * is the standard Omaha structure and the reason PLO plays differently from a
 * game where anyone can shove on any street.
 */
export type BetLimit = 'NO_LIMIT' | 'POT_LIMIT';

export interface BettingConfig {
  smallBlind: number;
  bigBlind: number;
  buttonIndex?: number;
  /** Defaults to NO_LIMIT, which is what every existing caller assumed. */
  limit?: BetLimit;
}

interface Seat {
  id: string;
  stack: number;
  status: SeatStatus;
  streetContributed: number;
  totalContributed: number;
  hasActed: boolean;
}

export class IllegalActionError extends Error {}

export class TexasBetting {
  private readonly seats: Seat[];
  private readonly n: number;
  private readonly button: number;
  private readonly smallBlind: number;
  private readonly bigBlind: number;

  private _street: Street = 'PREFLOP';
  private currentBet = 0;
  private minRaise: number;
  private toActIndex = -1;
  private readonly limit: BetLimit;

  /**
   * The largest legal raise-TO for the player on the clock.
   *
   * No-limit is their whole stack. Pot-limit is the pot AFTER they call:
   *
   *   pot 100, opponent bets 50 → they call 50 (pot 200) → may raise 200 more
   *   → maximum total in = 250
   *
   * `pot` already counts every chip committed this hand, including the bet
   * being called, so the call is added once here and not twice. Still bounded
   * by the stack: pot-limit raises the ceiling, it never lets someone bet chips
   * they do not have.
   */
  private maxRaiseToFor(seat: Seat): number {
    const allIn = seat.streetContributed + seat.stack;
    if (this.limit === 'NO_LIMIT') return allIn;
    const toCall = this.currentBet - seat.streetContributed;
    const potAfterCall = this.pot + toCall;
    return Math.min(allIn, this.currentBet + potAfterCall);
  }

  constructor(players: { id: string; stack: number }[], cfg: BettingConfig) {
    if (players.length < 2) throw new Error('need at least 2 players');
    this.n = players.length;
    this.button = cfg.buttonIndex ?? 0;
    this.smallBlind = cfg.smallBlind;
    this.bigBlind = cfg.bigBlind;
    this.minRaise = cfg.bigBlind;
    this.limit = cfg.limit ?? 'NO_LIMIT';
    this.seats = players.map((p) => ({
      id: p.id,
      stack: p.stack,
      status: 'active',
      streetContributed: 0,
      totalContributed: 0,
      hasActed: false,
    }));

    const sb = this.n === 2 ? this.button : (this.button + 1) % this.n;
    const bb = this.n === 2 ? (this.button + 1) % this.n : (this.button + 2) % this.n;
    this.postBlind(sb, this.smallBlind);
    this.postBlind(bb, this.bigBlind);
    this.currentBet = Math.max(this.seats[sb]!.streetContributed, this.seats[bb]!.streetContributed);

    // First to act preflop: heads-up = button (SB); otherwise the seat after the big blind.
    const firstPreflop = this.n === 2 ? this.button : (this.button + 3) % this.n;
    this.toActIndex = this.nextActionableFrom(firstPreflop);
  }

  // ── Public state ────────────────────────────────────────────────────────────

  get street(): Street {
    return this._street;
  }

  get pot(): number {
    return this.seats.reduce((sum, s) => sum + s.totalContributed, 0);
  }

  get toAct(): string | null {
    return this.toActIndex >= 0 ? this.seats[this.toActIndex]!.id : null;
  }

  /** True when betting is finished (showdown reached, or only one player remains). */
  get handComplete(): boolean {
    return this._street === 'SHOWDOWN' || this.notFolded().length === 1;
  }

  seatsPublic(): SeatPublic[] {
    return this.seats.map((s) => ({
      id: s.id,
      stack: s.stack,
      status: s.status,
      streetContributed: s.streetContributed,
      totalContributed: s.totalContributed,
    }));
  }

  /** Players who have not folded (still eligible to win the pot). */
  notFolded(): string[] {
    return this.seats.filter((s) => s.status !== 'folded').map((s) => s.id);
  }

  /** Total each player has put in this hand — input to side-pot construction. */
  contributions(): Map<string, number> {
    return new Map(this.seats.map((s) => [s.id, s.totalContributed]));
  }

  /** If everyone but one has folded, that player wins without showdown. */
  winnerByFold(): string | null {
    const live = this.seats.filter((s) => s.status !== 'folded');
    return live.length === 1 ? live[0]!.id : null;
  }

  legalActions(): LegalActions {
    const seat = this.seats[this.toActIndex];
    if (!seat)
      return {
        canFold: false,
        canCheck: false,
        callAmount: null,
        minRaiseTo: null,
        maxRaiseTo: null,
        allInRaiseTo: null,
      };
    const toCall = this.currentBet - seat.streetContributed;
    const maxRaiseTo = this.maxRaiseToFor(seat);
    const canRaise = maxRaiseTo > this.currentBet;
    return {
      canFold: true,
      canCheck: toCall === 0,
      callAmount: toCall > 0 ? Math.min(toCall, seat.stack) : null,
      minRaiseTo: canRaise ? Math.min(this.currentBet + this.minRaise, maxRaiseTo) : null,
      maxRaiseTo: canRaise ? maxRaiseTo : null,
      // Reported whether or not a raise is legal: it is a fact about the seat,
      // and the confirm gate needs it precisely when the cap has hidden it.
      allInRaiseTo: seat.streetContributed + seat.stack,
    };
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  act(playerId: string, action: Action): void {
    const seat = this.seats[this.toActIndex];
    if (!seat || seat.id !== playerId) {
      throw new IllegalActionError(`not ${playerId}'s turn`);
    }
    const toCall = this.currentBet - seat.streetContributed;

    switch (action.type) {
      case 'fold':
        seat.status = 'folded';
        seat.hasActed = true;
        break;
      case 'check':
        if (toCall !== 0) throw new IllegalActionError('cannot check facing a bet');
        seat.hasActed = true;
        break;
      case 'call': {
        if (toCall <= 0) throw new IllegalActionError('nothing to call');
        this.commit(seat, Math.min(toCall, seat.stack));
        seat.hasActed = true;
        break;
      }
      case 'raise': {
        this.applyRaise(seat, action.amount ?? 0);
        break;
      }
      default:
        throw new IllegalActionError('unknown action');
    }

    this.advance();
  }

  private applyRaise(seat: Seat, raiseTo: number): void {
    const allIn = seat.streetContributed + seat.stack;
    // The pot-limit cap is ENFORCED here, not merely advertised in
    // legalActions. A client that ignores the number it was sent — or one
    // written by someone else — must be refused, or "pot limit" is a suggestion.
    const maxRaiseTo = this.maxRaiseToFor(seat);
    if (raiseTo <= this.currentBet) throw new IllegalActionError('raise must exceed current bet');
    if (raiseTo > maxRaiseTo) {
      throw new IllegalActionError(
        this.limit === 'POT_LIMIT' ? 'raise exceeds the pot' : 'raise exceeds stack',
      );
    }

    // All-in still means "everything they have", not "the pot-limit ceiling" —
    // a capped raise below their stack is an ordinary raise, and calling it
    // all-in would exempt it from the min-raise rule.
    const isAllIn = raiseTo === allIn;
    const raiseSize = raiseTo - this.currentBet;
    if (raiseSize < this.minRaise && !isAllIn) {
      throw new IllegalActionError(`raise must be at least ${this.minRaise}`);
    }

    this.commit(seat, raiseTo - seat.streetContributed);
    // A full-size raise reopens the action and sets the new min-raise increment.
    if (raiseSize >= this.minRaise) this.minRaise = raiseSize;
    this.currentBet = raiseTo;
    // Everyone still active who hasn't matched must act again.
    for (const s of this.seats) {
      if (s !== seat && s.status === 'active') s.hasActed = false;
    }
    seat.hasActed = true;
  }

  private commit(seat: Seat, chips: number): void {
    const amount = Math.min(chips, seat.stack);
    seat.stack -= amount;
    seat.streetContributed += amount;
    seat.totalContributed += amount;
    if (seat.stack === 0) seat.status = 'allin';
  }

  private postBlind(index: number, amount: number): void {
    this.commit(this.seats[index]!, amount);
  }

  // ── Turn / street advancement ────────────────────────────────────────────────

  private advance(): void {
    if (this.notFolded().length === 1) {
      this.toActIndex = -1; // hand won by fold
      return;
    }
    const next = this.nextActionableFrom((this.toActIndex + 1) % this.n);
    if (next >= 0) {
      this.toActIndex = next;
    } else {
      this.endStreet();
    }
  }

  /** First seat from `start` (inclusive, scanning clockwise) that still needs to act, or -1. */
  private nextActionableFrom(start: number): number {
    for (let i = 0; i < this.n; i++) {
      const idx = (start + i) % this.n;
      const s = this.seats[idx]!;
      if (s.status === 'active' && (!s.hasActed || s.streetContributed < this.currentBet)) {
        return idx;
      }
    }
    return -1;
  }

  private canStillAct(): number {
    return this.seats.filter((s) => s.status === 'active').length;
  }

  private endStreet(): void {
    if (this._street === 'RIVER') {
      this._street = 'SHOWDOWN';
      this.toActIndex = -1;
      return;
    }
    // If fewer than 2 players can still act, the remaining streets are dealt with no betting.
    if (this.canStillAct() < 2) {
      this._street = 'SHOWDOWN';
      this.toActIndex = -1;
      return;
    }
    this._street = this._street === 'PREFLOP' ? 'FLOP' : this._street === 'FLOP' ? 'TURN' : 'RIVER';
    this.startNewStreet();
  }

  private startNewStreet(): void {
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    for (const s of this.seats) {
      s.streetContributed = 0;
      s.hasActed = false;
    }
    // First to act postflop: heads-up = big blind (non-button); otherwise first seat after button.
    const firstPostflop = (this.button + 1) % this.n;
    this.toActIndex = this.nextActionableFrom(firstPostflop);
    if (this.toActIndex < 0) this.endStreet();
  }
}
