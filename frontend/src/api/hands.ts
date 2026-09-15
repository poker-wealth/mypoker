import { api } from './client';

/**
 * The hands you played at one table — `GET /me/hands`.
 *
 * Shaped by the gateway's `handViewFor` (game-server/src/history/hand-view.ts):
 * an opponent's `holeCards` is null unless the table saw them at a showdown.
 * The client never receives cards it should not show, so it has nothing to hide.
 */

export interface HandSeatView {
  playerId: string;
  seatIndex: number;
  position: string;
  /** Null when you may not see them. */
  holeCards: string[] | null;
  /** Table chips won or lost across the hand. Signed. */
  net: number;
  sawShowdown: boolean;
  wonAtShowdown: boolean;
  isYou: boolean;
}

export interface HandView {
  roundId: string;
  handNumber: number;
  /** ISO timestamp. */
  playedAt: string;
  bigBlind: number;
  community: string[];
  seats: HandSeatView[];
}

export const fetchTableHands = (tableId: string): Promise<{ hands: HandView[] }> =>
  api.get<{ hands: HandView[] }>(`/me/hands?tableId=${encodeURIComponent(tableId)}`);
