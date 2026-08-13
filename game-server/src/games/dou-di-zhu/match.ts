import { type Combination, type Combo, classifyCards } from './combos';
import { build54Deck, cardRank } from './ddz-deck';
import { validateMove } from './validator';

/**
 * DouDiZhuMatch — one complete game of Fight the Landlord, and nothing else.
 *
 * No money, no sockets, no rendering: deal, bid, play, pass, win. The live money table has its own
 * engine because it has to settle; this one exists so a game can be played on its own — against
 * house AI in a simulator, or driven by tests — with the same rules module (`combos`, `validator`)
 * deciding what is legal. Rules live in one place; only the wrapper differs.
 *
 * The match is authoritative. It is handed card selections and returns what happened; it never
 * trusts a caller's idea of whether a play was legal, whose turn it is, or who won.
 */

export type Role = 'LANDLORD' | 'PEASANT';

export type GameStatus = 'BIDDING' | 'PLAYING' | 'LANDLORD_WON' | 'PEASANTS_WON';

export interface MatchPlayer {
  id: string;
  name: string;
  role: Role | null;
  /** Cards in hand, ascending. Hidden from other players by the caller, not by this class. */
  hand: string[];
}

export interface BidState {
  /** What each player has bid so far: 0 (pass) to 3. */
  bids: Record<string, number>;
  /** Who is being asked to bid right now, or null once the auction is over. */
  currentBidderId: string | null;
  /** The winning bid, once there is one. */
  winningBid: number | null;
}

/** The whole game, as anything outside needs to see it. */
export interface MatchState {
  players: MatchPlayer[];
  landlordId: string | null;
  peasantIds: string[];
  bonusCards: string[];
  /** Face-down until the landlord is chosen. */
  bonusRevealed: boolean;
  currentPlayerId: string;
  lastCombination: Combination | null;
  lastPlayerId: string | null;
  trickLeaderId: string;
  passCount: number;
  gameStatus: GameStatus;
  bidState: BidState;
  /** Every play and pass this game, oldest first. */
  history: MatchEvent[];
}

export interface MatchEvent {
  playerId: string;
  kind: 'PLAY' | 'PASS';
  cards?: string[];
  combination?: Combination;
}

export type TurnDirection = 'COUNTERCLOCKWISE' | 'CLOCKWISE';

/** Who takes the bank when nobody bids. Configurable — the default draws at random. */
export type NoBidFallback = (playerIds: string[], randomFn: () => number) => string;

export const randomLandlord: NoBidFallback = (ids, randomFn) =>
  ids[Math.floor(randomFn() * ids.length)]!;

export const firstSeatLandlord: NoBidFallback = (ids) => ids[0]!;

export interface MatchOptions {
  /** Table order. Dou Di Zhu runs counterclockwise; the other way round is a house rule. */
  turnDirection?: TurnDirection;
  /** Seeded for tests, `Math.random` in play. */
  randomFn?: () => number;
  noBidFallback?: NoBidFallback;
}

export class IllegalMoveError extends Error {}

const HAND_SIZE = 17;

export class DouDiZhuMatch {
  private readonly state: MatchState;
  private readonly direction: TurnDirection;
  private readonly randomFn: () => number;
  private readonly noBidFallback: NoBidFallback;

  constructor(players: { id: string; name: string }[], options: MatchOptions = {}) {
    if (players.length !== 3) throw new Error('Dou Di Zhu is a three-player game');
    this.direction = options.turnDirection ?? 'COUNTERCLOCKWISE';
    this.randomFn = options.randomFn ?? Math.random;
    this.noBidFallback = options.noBidFallback ?? randomLandlord;

    const deck = this.shuffle(build54Deck());
    const seated: MatchPlayer[] = players.map((p, seat) => ({
      id: p.id,
      name: p.name,
      role: null,
      hand: this.sort(deck.slice(seat * HAND_SIZE, (seat + 1) * HAND_SIZE)),
    }));

    this.state = {
      players: seated,
      landlordId: null,
      peasantIds: [],
      bonusCards: deck.slice(3 * HAND_SIZE),
      bonusRevealed: false,
      currentPlayerId: seated[0]!.id,
      lastCombination: null,
      lastPlayerId: null,
      trickLeaderId: seated[0]!.id,
      passCount: 0,
      gameStatus: 'BIDDING',
      bidState: { bids: {}, currentBidderId: seated[0]!.id, winningBid: null },
      history: [],
    };
  }

  /** The game as the outside world may read it — a copy, so nobody can deal themselves a card. */
  getState(): MatchState {
    return structuredClone(this.state);
  }

  /** Only this player's own hand; everyone else's is a count. */
  handOf(playerId: string): string[] {
    return [...this.player(playerId).hand];
  }

  cardCounts(): Record<string, number> {
    return Object.fromEntries(this.state.players.map((p) => [p.id, p.hand.length]));
  }

  // ── Bidding ─────────────────────────────────────────────────────────────────

  /**
   * Bid 0 (pass) to 3 for the landlord's chair. The auction ends when everyone has spoken; the
   * highest bid takes it, and a table where nobody bid falls to the configured rule.
   */
  bid(playerId: string, points: number): void {
    if (this.state.gameStatus !== 'BIDDING') throw new IllegalMoveError('the auction is over');
    if (this.state.bidState.currentBidderId !== playerId) {
      throw new IllegalMoveError('it is not your turn to bid');
    }
    if (!Number.isInteger(points) || points < 0 || points > 3) {
      throw new IllegalMoveError('a bid is 0 (pass) to 3');
    }

    this.state.bidState.bids[playerId] = points;

    if (Object.keys(this.state.bidState.bids).length === this.state.players.length) {
      this.chooseLandlord();
      return;
    }
    this.state.bidState.currentBidderId = this.nextSeat(playerId);
  }

  private chooseLandlord(): void {
    const bids = this.state.bidState.bids;
    const best = Math.max(...Object.values(bids));
    const ids = this.state.players.map((p) => p.id);

    const landlordId =
      best === 0
        ? this.noBidFallback(ids, this.randomFn)
        : ids.find((id) => bids[id] === best)!;

    const landlord = this.player(landlordId);
    landlord.role = 'LANDLORD';
    landlord.hand = this.sort([...landlord.hand, ...this.state.bonusCards]);

    for (const p of this.state.players) {
      if (p.id !== landlordId) p.role = 'PEASANT';
    }

    this.state.landlordId = landlordId;
    this.state.peasantIds = this.state.players.filter((p) => p.role === 'PEASANT').map((p) => p.id);
    this.state.bonusRevealed = true;
    this.state.bidState.winningBid = Math.max(1, best);
    this.state.bidState.currentBidderId = null;
    this.state.currentPlayerId = landlordId;
    this.state.trickLeaderId = landlordId;
    this.state.gameStatus = 'PLAYING';
  }

  // ── Playing ─────────────────────────────────────────────────────────────────

  /**
   * Play cards. Throws unless they are this player's, form a legal combination, and beat whatever
   * is on the table — the caller finds out by being refused, never by the match accepting a move
   * it should not have.
   */
  play(playerId: string, cards: string[]): Combination {
    this.requireTurn(playerId);
    const player = this.player(playerId);

    // Only beat the play on the table if it is somebody else's; holding the trick means leading.
    const toBeat = this.mustBeat(playerId);
    const result = validateMove(cards, toBeat, player.hand);
    if (!result.valid) throw new IllegalMoveError(result.reason ?? 'illegal move');

    const combination = classifyCards(cards, cardRank)!;
    for (const card of cards) player.hand.splice(player.hand.indexOf(card), 1);

    this.state.lastCombination = combination;
    this.state.lastPlayerId = playerId;
    this.state.trickLeaderId = playerId;
    this.state.passCount = 0;
    this.state.history.push({ playerId, kind: 'PLAY', cards: [...cards], combination });

    if (player.hand.length === 0) {
      this.state.gameStatus = player.role === 'LANDLORD' ? 'LANDLORD_WON' : 'PEASANTS_WON';
      return combination;
    }

    this.state.currentPlayerId = this.nextSeat(playerId);
    return combination;
  }

  /** Pass. Illegal when you hold the trick — there is nothing to pass on. */
  pass(playerId: string): void {
    this.requireTurn(playerId);
    if (!this.mustBeat(playerId)) throw new IllegalMoveError('you lead this trick, you cannot pass');

    this.state.passCount += 1;
    this.state.history.push({ playerId, kind: 'PASS' });

    // Both opponents passed: the trick is won, and its winner leads the next one.
    if (this.state.passCount >= this.state.players.length - 1) {
      this.state.currentPlayerId = this.state.trickLeaderId;
      this.state.lastCombination = null;
      this.state.lastPlayerId = null;
      this.state.passCount = 0;
      return;
    }
    this.state.currentPlayerId = this.nextSeat(playerId);
  }

  /** What this player has to beat right now, or null when the lead is theirs. */
  mustBeat(playerId: string): Combo | null {
    const { lastCombination, lastPlayerId } = this.state;
    if (!lastCombination || lastPlayerId === playerId) return null;
    return lastCombination;
  }

  get status(): GameStatus {
    return this.state.gameStatus;
  }

  get winnerRole(): Role | null {
    if (this.state.gameStatus === 'LANDLORD_WON') return 'LANDLORD';
    if (this.state.gameStatus === 'PEASANTS_WON') return 'PEASANT';
    return null;
  }

  // ── Seating ─────────────────────────────────────────────────────────────────

  /**
   * The next seat round the table. Counterclockwise by default — which is the direction Dou Di Zhu
   * is played in — and configurable because house rules differ.
   */
  private nextSeat(playerId: string): string {
    const ids = this.state.players.map((p) => p.id);
    const step = this.direction === 'COUNTERCLOCKWISE' ? 1 : ids.length - 1;
    return ids[(ids.indexOf(playerId) + step) % ids.length]!;
  }

  private requireTurn(playerId: string): void {
    if (this.state.gameStatus !== 'PLAYING') throw new IllegalMoveError('the game is not in play');
    if (this.state.currentPlayerId !== playerId) throw new IllegalMoveError('it is not your turn');
  }

  private player(playerId: string): MatchPlayer {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) throw new Error(`no such player: ${playerId}`);
    return player;
  }

  private sort(cards: string[]): string[] {
    return [...cards].sort((a, b) => cardRank(a) - cardRank(b));
  }

  private shuffle(deck: string[]): string[] {
    const out = [...deck];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.randomFn() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
}
