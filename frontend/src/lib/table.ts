import type { Card } from './cards';

/**
 * View-model for the poker table screen. This is deliberately UI-shaped (what a seat
 * needs to render) rather than the engine's authoritative state — the GameService feed
 * will be mapped into this later.
 */
export type SeatStatus = 'active' | 'folded' | 'allin' | 'empty' | 'toact';

export interface Seat {
  id: number;
  playerId?: string;
  name: string;
  avatar?: string;
  stack: number;
  /** current chips committed in front of the seat this street */
  bet: number;
  cards: (Card | null)[]; // hole cards; null = face-down (unseen)
  status: SeatStatus;
  isHero?: boolean;
  isDealer?: boolean;
  isWinner?: boolean;

  // ── Live tables only (the demo engine leaves these undefined) ──
  /** What they last did this street — the bubble over the seat ("Call", "Raise ₮120"). */
  lastAction?: string;
  /** False while their socket is down; they still have their seat and their clock. */
  connected?: boolean;
  /** They're at the table but not being dealt in. */
  sittingOut?: boolean;
  /** Epoch ms this seat's clock expires — set only on the seat that is to act. */
  deadline?: number;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export interface TableState {
  handId: string;
  street: Street;
  pot: number;
  board: Card[]; // 0,3,4,5 community cards
  seats: Seat[];
  heroSeat: number;
  toCall: number; // amount the hero must call
  currentBet: number; // highest bet this street
  minRaise: number; // minimum raise increment
  message?: string;
  handOver?: boolean;
}
