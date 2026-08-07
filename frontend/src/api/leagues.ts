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
