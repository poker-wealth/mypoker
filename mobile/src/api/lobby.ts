import { api } from '../api';

/**
 * Lobby reads.
 *
 * Ported from `frontend/src/api/lobby.ts`. Public — no token needed, which is why these work
 * against staging while the player-scoped endpoints do not.
 *
 * All money and stake figures are integer **micro-USD** (1 USD = 1_000_000), matching the server.
 * Never parse them into a float for display maths — divide once at the point of rendering.
 */

export type FairnessTier = 'PROVABLE' | 'VENDOR_ATTESTED';

export interface GameSummary {
  gameId: string;
  name: string;
  fairness: FairnessTier;
  vendor?: string;
  available: boolean;
  tables: number;
  players: number;
  /** micro-USD */
  jackpot: number;
}

export interface LobbyGames {
  games: GameSummary[];
  /** micro-USD */
  totalJackpot: number;
}

export interface TableView {
  id: string;
  gameId: string;
  name: string;
  /** micro-USD */
  stakes: number;
  players: number;
  /** micro-USD */
  jackpot: number;
  /** Minimum buy-in in big blinds — comparable across stake levels, unlike cash. */
  buyInBB: number;
  status: 'UNAVAILABLE' | 'WAITING' | 'OPEN' | 'FULL';
  minPlayers: number;
  maxPlayers: number;
  fairness: FairnessTier;
  vendor?: string;
  seatsFree: number;
  waitingFor?: number;
}

export interface TableFilter {
  gameId?: string;
  minStakes?: number;
  maxStakes?: number;
  hasSeats?: boolean;
  minJackpot?: number;
  readyOnly?: boolean;
  fairness?: FairnessTier;
}

export function fetchLobbyGames(): Promise<LobbyGames> {
  return api.get<LobbyGames>('/lobby/games');
}

export function fetchTables(filter: TableFilter = {}): Promise<{
  tables: TableView[];
  count: number;
}> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const suffix = query.toString();
  return api.get(`/lobby/tables${suffix ? `?${suffix}` : ''}`);
}

/** micro-USD → a display string. One conversion, at the edge. */
export function formatMicros(micros: number, maximumFractionDigits = 0): string {
  return (micros / 1_000_000).toLocaleString(undefined, { maximumFractionDigits });
}
