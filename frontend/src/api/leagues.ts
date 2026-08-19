import { api } from './client';

/** Alliances (leagues). Mirrors financial-core/src/league/league-store.ts. */

export interface League {
  leagueId: string;
  name: string;
  ownerId: string;
  description: string | null;
  inviteOnly: boolean;
  memberCount: number;
  createdAt: string;
}

export const fetchMyLeagues = (): Promise<{ leagues: League[] }> =>
  api.get<{ leagues: League[] }>('/me/leagues');

/** Discovery. Invite-only leagues are excluded server-side, not filtered here. */
export const fetchLeagues = (): Promise<{ leagues: League[] }> =>
  api.get<{ leagues: League[] }>('/leagues');

export const createLeagueApi = (body: {
  leagueId: string;
  name: string;
  inviteOnly?: boolean;
}): Promise<League> => api.post<League>('/leagues', body);

export const joinLeagueApi = (leagueId: string): Promise<League> =>
  api.post<League>(`/leagues/${encodeURIComponent(leagueId)}/join`);

/**
 * One league, with the facts a private room depends on.
 *
 * `settings` is null until the league has chosen a rake and buy-in — the exact
 * state the create-table endpoint refuses with "set the league rake and buy-in
 * before opening a table", so reading it first turns that 400 into something
 * the screen can say BEFORE the attempt rather than after it.
 *
 * There is deliberately no `role` here: financial-core's `GET /leagues/:id`
 * returns the league, not the caller's membership, and the only role lookup is
 * an internal service route the browser cannot call. See CreateTableSheet for
 * what the UI does instead of guessing.
 */
export interface LeagueDetail extends League {
  settings: {
    /** Basis points. 250 = 2.5%. */
    rakeBps: number;
    tableHours: number;
    buyIn: number;
    spectatorsAllowed: boolean;
  } | null;
  /** A rake change accepted but inside its 7-day transition; not in force yet. */
  pendingRakeChange: { rakeBps: number; effectiveAt: string } | null;
}

export const fetchLeague = (leagueId: string): Promise<LeagueDetail> =>
  api.get<LeagueDetail>(`/leagues/${encodeURIComponent(leagueId)}`);

/** Poker variants a league room can host — the endpoint's own enum. */
export type LeagueTableVariant = 'texas' | 'short-deck' | 'omaha';

export interface CreateLeagueTableInput {
  leagueId: string;
  variantId: LeagueTableVariant;
  smallBlind: number;
  bigBlind: number;
  /** 2..9. */
  maxSeats: number;
  name?: string;
}

/** The room that was opened. `rakeBps` is the rate the table ACTUALLY opened on. */
export interface LeagueTable {
  tableId: string;
  name: string;
  leagueId: string;
  variantId: LeagueTableVariant;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  rakeBps: number;
  rakeDestination: 'LEAGUE_INVENTORY';
  spectatorsAllowed: boolean;
}

/**
 * Open a league private room. Owner/admin only, enforced server-side — the
 * caller's role is not knowable in the browser, so this is allowed to fail with
 * 403 and the UI translates that answer instead of pre-empting it.
 */
export const createLeagueTableApi = ({
  leagueId,
  ...body
}: CreateLeagueTableInput): Promise<LeagueTable> =>
  api.post<LeagueTable>(`/leagues/${encodeURIComponent(leagueId)}/tables`, body);
