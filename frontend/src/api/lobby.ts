import { api } from './client';
import { contextParam } from '@/store/context';

/**
 * Lobby reads. Public — no token needed, which is why these work on staging
 * while the player-scoped endpoints don't.
 *
 * All money and stake figures are integer **micro-USD** (1 USD = 1_000_000),
 * matching the server. Never parse them into a float for display maths —
 * divide once at the point of rendering.
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
  /**
   * Stake level in TABLE CHIPS — the big blind for poker, a fixed base stake
   * for a game that has one, or null for a game with neither.
   *
   * CHIPS, NOT MICRO-USD. This field has been the source of the same bug
   * twice: it was micro-USD while `dev-seed.ts` supplied the lobby, the
   * placeholder seeder was replaced by the live rooms, and nothing here
   * changed. `formatMicros` kept dividing by a million, so a big blind of 100
   * rendered as "0" and every real table read "Blinds 0/0". See
   * docs/TRAPS.md #2, which describes exactly this and was written before it
   * had been fixed on this side.
   */
  stakes: number | null;
  /** The small blind, sent by the server rather than derived as `stakes / 2`. */
  smallBlind?: number | null;
  players: number;
  /** micro-USD */
  jackpot: number;
  /**
   * Minimum buy-in in big blinds — comparable across stake levels, unlike cash.
   * Null when the table has no stake level to measure depth against; "0 BB" is
   * a claim about depth, and an unmeasurable depth is not a shallow one.
   */
  buyInBB: number | null;
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

/**
 * Every lobby read takes the context explicitly.
 *
 * Not read from the store inside these functions: a caller that forgets to pass
 * it then silently gets the platform lobby, and a defaulted argument is visible
 * at the call site where the omission can be noticed. The server re-checks
 * membership regardless — this only decides which question is asked.
 */
export function fetchLobbyGames(leagueId: string | null = null): Promise<LobbyGames> {
  const ctx = contextParam(leagueId);
  return api.get<LobbyGames>(`/lobby/games${ctx ? `?${ctx}` : ''}`);
}

export function fetchTables(
  filter: TableFilter = {},
  leagueId: string | null = null,
): Promise<{ tables: TableView[]; count: number }> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined) query.set(key, String(value));
  }
  if (leagueId) query.set('leagueId', leagueId);
  const suffix = query.toString();
  return api.get(`/lobby/tables${suffix ? `?${suffix}` : ''}`);
}

/** micro-USD → a display string. One conversion, at the edge. */
export function formatMicros(micros: number, maximumFractionDigits = 0): string {
  return (micros / 1_000_000).toLocaleString(undefined, { maximumFractionDigits });
}
