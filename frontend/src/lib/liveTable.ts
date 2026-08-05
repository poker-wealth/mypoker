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
  pot: number;
  board: Card[];
  seats: LiveSeat[];

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

export type TableCommand =
  | { kind: 'sit'; seat: number; buyIn: number }
  | { kind: 'stand' }
  | { kind: 'act'; action: { type: 'fold' | 'check' | 'call' | 'raise'; amount?: number } }
  | { kind: 'sitOut' }
  | { kind: 'sitIn' }
  | { kind: 'buyIn'; amount: number };
