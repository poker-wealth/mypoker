import type { Card } from './cards';

/**
 * The live table wire contract — the client half of `game-server/src/live/room-state.ts`.
 *
 * Keep the two in step. Everything here is what the SERVER decided; the client renders it and
 * sends back commands. It never computes a stack, a pot or a legal action of its own.
 */

export type RoomPhase = 'WAITING' | 'DEALING' | 'IN_HAND' | 'SHOWDOWN';
export type LiveSeatStatus = 'active' | 'folded' | 'allin' | 'waiting' | 'sittingout';
export type LiveStreet = 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  /** Chips needed to call, or null if there's nothing to call. */
  callAmount: number | null;
  /** Smallest legal raise-to, or null if raising isn't possible. */
  minRaiseTo: number | null;
  /** Largest raise-to (all-in). */
  maxRaiseTo: number | null;
}

export interface LiveSeat {
  index: number;
  playerId: string;
  name: string;
  avatarUrl?: string;
  stack: number;
  bet: number;
  status: LiveSeatStatus;
  inHand: boolean;
  connected: boolean;
  isDealer: boolean;
  isWinner: boolean;
  isYou: boolean;
  /** This chair is played by the house AI (practice tables). Absent means a person is sitting there. */
  isBot?: boolean;
  /** Card strings you're allowed to see; `null` is a face-down card. */
  cards: (Card | null)[];
  lastAction?: string;
}

export interface FairnessSnapshot {
  roundId: string;
  serverCommit: string;
  serverSeed?: string;
  futureBlockHash?: string;
  finalSeed?: string;
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
  street: LiveStreet | null;
  /**
   * A game-specific sub-phase inside `IN_HAND` — Dou Di Zhu sends `BIDDING` / `PLAYING`. Games
   * without stages omit it. Decides which controls to show, never anything about money.
   */
  stage?: string;
  /**
   * Public, game-specific round state for felts that need more than the shared shape — Texas
   * Cowboy's two hands, its markets and its betting window. Each felt narrows it to its own type.
   * Mirrors `gameState` in game-server/src/live/room-state.ts.
   */
  gameState?: unknown;
  pot: number;
  board: Card[];
  seats: LiveSeat[];

  /**
   * An insurance offer for THIS viewer, or null.
   *
   * Per-viewer by construction: the server only puts one here for the two
   * all-in players. Null means every case where no prompt should appear —
   * not eligible, not at risk, three or more all-in — so the client renders on
   * presence alone and never has to know the spec's show/skip rule.
   *
   * Odds only. Mirrors InsuranceOffer in game-server/src/live/room-state.ts.
   */
  /** A jackpot hit this hand, shown to every viewer. Mirrors JackpotWinSnapshot. */
  jackpot: {
    tier: 'MINI' | 'MINOR' | 'MAJOR' | 'GRAND';
    playerId: string;
    playerName: string;
    /** Table currency (chips). */
    amount: number;
    animationMs: number;
    roundId: string;
  } | null;

  insurance: {
    premium: number;
    coverage: number;
    payoutOdds: number;
    expiresInSeconds: number;
  } | null;

  yourSeat: number | null;
  you: { playerId: string; name: string; available: number } | null;
  toActSeat: number | null;
  actionDeadline: number | null;
  legal: LegalActions | null;
  winners: number[];
  message?: string;
  fairness?: FairnessSnapshot;
  serverTime: number;
}

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

/**
 * A move, in whatever vocabulary the game speaks.
 *
 * Poker sends `fold` / `check` / `call` / `raise`; the other games send their own verbs (`play`,
 * `pass`, `bid-2`, `claim-banker`, `spin`, a baccarat bet spot, a minesweeper cell…). Mirrors
 * `betActionSchema` in game-server/src/live/room-state.ts — in particular `cards` belongs HERE,
 * inside the action, not beside it on the command: the wire schema strips anything else and the
 * room would see a play with no cards in it.
 */
export interface TableAction {
  type: 'fold' | 'check' | 'call' | 'raise' | (string & {});
  amount?: number;
  /** 1x / 2x / 5x — the stake multiplier, or a bid for the bank. */
  multiplier?: number;
  /** The card combination, for games where a move is cards (Dou Di Zhu). */
  cards?: string[];
  selection?: string;
}

export type TableCommand =
  | { kind: 'sit'; seat: number; buyIn: number }
  | { kind: 'stand' }
  | { kind: 'act'; action: TableAction }
  | { kind: 'sitOut' }
  | { kind: 'sitIn' }
  | { kind: 'buyIn'; amount: number }
  | { kind: 'chat'; message: string }
  | { kind: 'challenge'; targetId: string }
  | { kind: 'answer_challenge'; passed: boolean; responseMs: number }
  | { kind: 'set_client_seed'; seed: string };
