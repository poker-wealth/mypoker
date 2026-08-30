import { type HandRank } from './hand-evaluator';
import { TEXAS, type PokerVariant } from './variants';
import {
  TexasBetting,
  type Action,
  type BettingConfig,
  type LegalActions,
  type SeatPublic,
  type Street,
} from './betting';
import { settleShowdown, type Pot } from './side-pots';

/**
 * TexasHand — orchestrates one complete hand of Texas Hold'em.
 *
 * Deals hole + community cards deterministically from the provably-fair shuffled deck (so the deal
 * is independently verifiable), drives the betting engine, reveals community cards as streets
 * advance, and at the end evaluates each surviving player's best 7-card hand and pays out the
 * pots (main + side). Works in table chips; the Financial Core money settlement (rake/jackpot)
 * sits on top of this result.
 *
 * Dealing convention (no burn cards — the deck is committed, so burns add nothing): player i gets
 * deck[i] and deck[n+i]; the five community cards are deck[2n..2n+4] (flop, turn, river).
 */

export interface TexasHandConfig extends BettingConfig {
  /** final_seed from the provably-fair pipeline — determines the deck. */
  seed: string;
  /** Which Hold'em variant to deal. Defaults to standard Texas. */
  variant?: PokerVariant;
}

export interface ShowdownEntry {
  id: string;
  hole: string[];
  rank: HandRank;
}

export interface HandResult {
  payouts: Map<string, number>;
  pots: Pot[];
  community: string[];
  /** Revealed hands at showdown (empty when the hand was won by everyone else folding). */
  showdown: ShowdownEntry[];
}

export class TexasHand {
  private readonly betting: TexasBetting;
  private readonly seatOrder: string[];
  private readonly hole = new Map<string, string[]>();
  private readonly fullCommunity: string[];
  private readonly variant: PokerVariant;
  private revealedCount = 0;
  private result: HandResult | null = null;

  constructor(players: { id: string; stack: number }[], config: TexasHandConfig) {
    const n = players.length;
    this.variant = config.variant ?? TEXAS;
    const h = this.variant.holeCards;
    const deck = this.variant.deckFor(config.seed);
    if (deck.length < n * h + 5) {
      throw new Error(`deck too small for ${n} players of ${this.variant.name}`);
    }

    this.seatOrder = players.map((p) => p.id);
    // Deal round-robin, as at a real table: every player gets their first card before anyone
    // gets a second. Card c of player i is deck[c*n + i].
    for (let i = 0; i < n; i++) {
      const cards: string[] = [];
      for (let c = 0; c < h; c++) cards.push(deck[c * n + i]!);
      this.hole.set(players[i]!.id, cards);
    }
    this.fullCommunity = deck.slice(h * n, h * n + 5);
    // The variant carries the betting structure — Omaha is pot-limit — but an
    // explicit config still wins, so a table can run a non-standard limit
    // without a new variant. Undefined at both levels means no-limit.
    this.betting = new TexasBetting(players, {
      ...config,
      ...(config.limit ?? this.variant.limit
        ? { limit: config.limit ?? this.variant.limit! }
        : {}),
    });
    this.syncCommunity();
  }

  // ── State ────────────────────────────────────────────────────────────────────
  get street(): Street {
    return this.betting.street;
  }
  get toAct(): string | null {
    return this.betting.toAct;
  }
  get pot(): number {
    return this.betting.pot;
  }
  get isComplete(): boolean {
    return this.result !== null;
  }

  community(): string[] {
    return this.fullCommunity.slice(0, this.revealedCount);
  }

  holeCardsFor(playerId: string): readonly string[] | undefined {
    return this.hole.get(playerId);
  }

  legalActions(): LegalActions {
    return this.betting.legalActions();
  }

  /** Per-seat betting detail (stack, status, chips committed) — what a live table renders. */
  seats(): SeatPublic[] {
    return this.betting.seatsPublic();
  }

  // ── Play ─────────────────────────────────────────────────────────────────────
  act(playerId: string, action: Action): void {
    if (this.result) throw new Error('hand is already complete');
    this.betting.act(playerId, action);
    this.syncCommunity();
    if (this.betting.handComplete) this.settle();
  }

  /** Reveal community cards appropriate to the current street. */
  private syncCommunity(): void {
    const street = this.betting.street;
    const target =
      street === 'FLOP' ? 3 : street === 'TURN' ? 4 : street === 'RIVER' || street === 'SHOWDOWN' ? 5 : 0;
    if (target > this.revealedCount) this.revealedCount = target;
  }

  private settle(): void {
    const foldWinner = this.betting.winnerByFold();
    if (foldWinner) {
      this.result = {
        payouts: new Map([[foldWinner, this.betting.pot]]),
        pots: [{ amount: this.betting.pot, eligible: [foldWinner] }],
        community: this.community(),
        showdown: [],
      };
      return;
    }

    // Showdown — reveal all five community cards and evaluate each surviving hand.
    this.revealedCount = 5;
    const notFolded = this.betting.notFolded();
    const hands = new Map<string, HandRank>();
    const showdown: ShowdownEntry[] = [];
    for (const id of notFolded) {
      const hole = this.hole.get(id)!;
      const rank = this.variant.evaluate(hole, this.fullCommunity);
      hands.set(id, rank);
      showdown.push({ id, hole: [...hole], rank });
    }
    const { pots, payouts } = settleShowdown({
      contributions: this.betting.contributions(),
      notFolded,
      hands,
      seatOrder: this.seatOrder,
    });
    this.result = { payouts, pots, community: this.community(), showdown };
  }

  /** Total each player put into the pot this hand (input to money settlement). */
  contributions(): Map<string, number> {
    return this.betting.contributions();
  }

  // ── Result ─────────────────────────────────────────────────────────────────────
  getResult(): HandResult | null {
    return this.result;
  }

  /** Each player's chip stack after the hand (remaining stack + winnings). */
  finalStacks(): Map<string, number> {
    const stacks = new Map(this.betting.seatsPublic().map((s) => [s.id, s.stack]));
    if (this.result) {
      for (const [id, won] of this.result.payouts) {
        stacks.set(id, (stacks.get(id) ?? 0) + won);
      }
    }
    return stacks;
  }
}
