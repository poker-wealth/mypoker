import { type HandRank } from './hand-evaluator';
import type { RecordedAction } from '../../history/hand-record';
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
  private readonly actionLog: RecordedAction[] = [];

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

    /*
     * THE ACTION LOG — recorded here, and only here.
     *
     * Everything the Data page cannot currently show (VPIP, PFR, 3-Bet, WTSD,
     * W$SD, Aggression) is derived from who did what before the flop and after
     * it. Nothing in this engine kept that: the betting layer applies an action
     * and moves on, so the moment a hand ended, how it was played was gone.
     *
     * CAPTURED BEFORE `betting.act`, not after, for two reasons that are both
     * bugs if ignored:
     *
     *   THE STREET ADVANCES INSIDE the call. A river call that closes the
     *   betting leaves `street` reading SHOWDOWN, so reading it afterwards
     *   files the last action of every street under the next one — and a
     *   preflop call that closes preflop would be recorded as a flop call,
     *   which is precisely the action VPIP is counted from.
     *
     *   THE AMOUNT IS A STACK DELTA, measured across the call. Using the
     *   action's own `amount` would be wrong for a raise (it is a raise-TO
     *   total, not the chips added) and absent for a call, which carries no
     *   amount at all. What left the player's stack is what they committed,
     *   whatever the action was called.
     *
     * BLIND POSTS ARE NOT ACTIONS and never reach here — they are posted by
     * the betting layer at setup. That is exactly right for VPIP, which counts
     * money put in BY CHOICE: a big blind who checks has not entered the pot.
     */
    const street = this.betting.street;
    const stackBefore = this.betting.seatsPublic().find((s) => s.id === playerId)?.stack ?? 0;

    this.betting.act(playerId, action);

    const stackAfter = this.betting.seatsPublic().find((s) => s.id === playerId)?.stack ?? 0;
    this.actionLog.push({
      playerId,
      street,
      type: action.type,
      amount: Math.max(0, stackBefore - stackAfter),
    });

    this.syncCommunity();
    if (this.betting.handComplete) this.settle();
  }

  /** Every action taken in this hand, in order. Empty before the first one. */
  actions(): readonly RecordedAction[] {
    return this.actionLog;
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
