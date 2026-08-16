import { z } from 'zod';
import type { LegalActions, Street } from '../games/texas/betting';

/**
 * The wire contract between a live table and its clients.
 *
 * Two rules shape everything here:
 *   - Iron rule #1 — the client is read-only. It receives `TableSnapshot` and sends `TableCommand`;
 *     the server decides what any of it means. Nothing in a command is trusted beyond its shape.
 *   - A snapshot is built PER VIEWER. Your hole cards are in your snapshot and in nobody else's,
 *     so an opponent's client physically cannot know your hand before showdown.
 */

export type RoomPhase = 'WAITING' | 'DEALING' | 'IN_HAND' | 'SHOWDOWN';

/** How a seat is doing in the hand in progress. */
export type SeatStatus = 'active' | 'folded' | 'allin' | 'waiting' | 'sittingout';

export interface SeatSnapshot {
  index: number;
  playerId: string;
  name: string;
  avatarUrl?: string;
  /** Chips in front of them. */
  stack: number;
  /** Chips pushed forward on the current street. */
  bet: number;
  status: SeatStatus;
  inHand: boolean;
  connected: boolean;
  isDealer: boolean;
  isWinner: boolean;
  isYou: boolean;
  /**
   * This chair is played by the house AI (practice tables only). Sent so the client can say so
   * plainly instead of assuming which seats are bots — at a table of three humans, none are.
   */
  isBot?: boolean;
  /**
   * Hole cards as the VIEWER may see them: card strings for your own seat (and for everyone shown
   * down at showdown), `null` for a face-down card, empty when they aren't in the hand.
   */
  cards: (string | null)[];
  /** Their last action this street ("Call", "Raise ₮120"…), for the seat bubble. */
  lastAction?: string;
}

/** Provably-fair data for the hand — the commit before, the seed after. */
export interface FairnessSnapshot {
  roundId: string;
  serverCommit: string;
  /** Revealed only once the hand is settled. */
  serverSeed?: string;
  futureBlockHash?: string;
  finalSeed?: string;
}

/** What a player is offered at an all-in. Odds only — no calculation details. */
export interface InsuranceOffer {
  /** micro-USD the player pays. */
  premium: number;
  /** micro-USD they receive if the hand goes against them. */
  coverage: number;
  /** coverage / premium. The only derived figure shown. */
  payoutOdds: number;
  /** Seconds the offer stands. */
  expiresInSeconds: number;
}

export interface JackpotWinSnapshot {
  tier: 'MINI' | 'MINOR' | 'MAJOR' | 'GRAND';
  playerId: string;
  playerName: string;
  /** Table currency (chips). */
  amount: number;
  animationMs: number;
  roundId: string;
}

export interface TableSnapshot {
  tableId: string;
  name: string;
  variant: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;

  phase: RoomPhase;
  handId: string | null;
  handNumber: number;
  street: Street | null;
  /**
   * A game-specific sub-phase inside `IN_HAND`, for games whose hand has stages the hub does not
   * model — Dou Di Zhu's `BIDDING` vs `PLAYING`, say. Omitted by games that have none. The client
   * uses it to decide which controls to offer; it is never used to decide money.
   */
  stage?: string;
  /**
   * Public round state for games whose felt needs more than the shared shape — Texas Cowboy's two
   * hands, its markets and its betting window, say.
   *
   * Opaque here on purpose: the hub does not care what a game puts in it, and each felt narrows it
   * to its own type. It exists because the alternative was serialising the round into `message`,
   * which is the human-readable line the result banner prints — so every table showed a wall of
   * JSON across the felt.
   *
   * Public means public: nothing in here may be hidden information (an unrevealed hole card, a
   * mine number, the rest of the deck), because every viewer receives it.
   */
  gameState?: unknown;
  /** Chips already collected into the middle (street bets are shown on the seats). */
  pot: number;
  board: string[];
  seats: SeatSnapshot[];

  /**
   * An insurance offer for THIS viewer, or null.
   *
   * Per-viewer, not per-table: only the two all-in players are offered anything,
   * and a spectator or a folded seat must not see one. Null covers both "not
   * eligible" and "declined" — the client renders the prompt only when a quote
   * is present, which is what makes the spec's "3+ silently skips" free rather
   * than a rule the UI has to remember.
   *
   * Carries the quote and nothing else. RiskFactor is never on it; see
   * game-server/src/games/texas/underwriting.ts.
   */
  insurance: InsuranceOffer | null;

  /**
   * A jackpot hit this hand, or null. Shown to EVERY viewer — a jackpot firing
   * is table news, not a private message — and cleared when the next hand
   * starts, so the animation's own duration governs how long it plays.
   */
  jackpot: JackpotWinSnapshot | null;

  /** Your seat index, or null if you're watching. */
  yourSeat: number | null;
  /** Who you are as far as the table is concerned — drives the buy-in sheet. */
  you: { playerId: string; name: string; available: number } | null;
  toActSeat: number | null;
  /** Epoch ms the player to act times out; compare against `serverTime`, not the local clock. */
  actionDeadline: number | null;
  /** Present only in YOUR snapshot, only when it is your turn. */
  legal: LegalActions | null;
  winners: number[];
  message?: string;
  fairness?: FairnessSnapshot;
  serverTime: number;
}

/** Compact row for a table list. */
export interface TableSummary {
  tableId: string;
  name: string;
  variant: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  seated: number;
  phase: RoomPhase;
}

// ── Client → server ───────────────────────────────────────────────────────────

/**
 * A move, in whatever vocabulary the game speaks.
 *
 * One command channel serves every table, so this has to cover poker's four verbs AND how the
 * other games name a move: a baccarat spot, a side, a grid cell, a lottery number, an auction bid.
 * An enumerated set plus two narrow patterns, not a bare string — the room still decides what a
 * move MEANS (range, stake, whose turn it is), but a shape no game speaks never reaches a room.
 *
 * Careful either way: too loose and the boundary checks nothing; too strict and a game is silently
 * unplayable over the socket while its in-process tests still pass, because those call the room
 * directly and never cross this schema. `wire-vocabulary.test.ts` pins one real command per game.
 */
export const betActionSchema = z.object({
  type: z.union([
    z.enum([
      // Poker
      'fold',
      'check',
      'call',
      'raise',
      // Stakes, the bank, a played combination, a pass, an auction bid
      'bet',
      'claim-banker',
      'claim',
      'play',
      'pass',
      'bid',
      // Baccarat spots and Cowboy & Beauty sides
      'player',
      'banker',
      'tie',
      'cowboy',
      'beauty',
      // Slots and lottery
      'spin',
      'buy-ticket',
      // Practice tables: how hard the house AI plays. A table setting, not a move.
      'ai-easy',
      'ai-medium',
      'ai-hard',
    ]),
    /**
     * An auction bid. Two games bid, for different things: Dou Di Zhu bids `bid-0` (pass) through
     * `bid-3` for the landlord's chair, Niu Niu bids `bid-1`, `bid-2` or `bid-5` for the bank — the
     * winning bid multiplies every settlement of the round. Only those five are spoken, so `bid-9`
     * stays junk rather than becoming a 9x bank nobody's stack was checked against.
     */
    z.string().regex(/^bid-(?:[0-3]|5)$/),
    /** A minesweeper cell or a lottery number — the room checks it against the board's range. */
    z.string().regex(/^\d{1,3}$/),
  ]),
  /** For 'raise' / bet actions: the amount or total target. */
  amount: z.number().int().nonnegative().optional(),
  /** 1x / 2x / 5x — the stake multiplier, or a bid for the bank. */
  multiplier: z.number().int().positive().optional(),
  /** For card games like Dou Dizhu: the played card combination. */
  cards: z.array(z.string()).optional(),
});

export const tableCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sit'),
    seat: z.number().int().min(0),
    buyIn: z.number().int().positive(),
    /**
     * How to label the seat. A display HINT only — identity is the verified token's player id, and
     * chips are looked up by that. Sending someone else's name gets you their nameplate, never
     * their money or their cards.
     */
    name: z.string().max(24).optional(),
    avatarUrl: z.string().url().max(300).optional(),
  }),
  z.object({ kind: z.literal('stand') }),
  z.object({ kind: z.literal('act'), action: betActionSchema }),
  z.object({ kind: z.literal('sitOut') }),
  z.object({ kind: z.literal('sitIn') }),
  /** Top up / rebuy an occupied seat between hands. */
  z.object({ kind: z.literal('buyIn'), amount: z.number().int().positive() }),
  /** Send a chat message to the room. */
  z.object({ kind: z.literal('chat'), message: z.string().max(200) }),
  /** Challenge a peer. */
  z.object({ kind: z.literal('challenge'), targetId: z.string() }),
  /** Answer a challenge. */
  z.object({ kind: z.literal('answer_challenge'), passed: z.boolean(), responseMs: z.number().nonnegative() }),
  /** Supply your own device-generated client seed (32 bytes hex) — your entropy for the shuffle. */
  z.object({ kind: z.literal('set_client_seed'), seed: z.string().regex(/^[0-9a-f]{64}$/i) }),
]);

export type TableCommand = z.infer<typeof tableCommandSchema>;
export type BetAction = z.infer<typeof betActionSchema>;
export type { LegalActions };
