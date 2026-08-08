import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchSettings, patchSettings, type PlayerSettings, type SettingsPatch } from './settings';
import { fetchReputation } from './reputation';
import { fetchJackpot, fetchJackpotHistory } from './jackpot';
import { fetchVip } from './vip';
import { fetchMyLeagues, fetchLeagues, createLeagueApi, joinLeagueApi } from './leagues';
import { fetchNotifications, markNotificationsRead, type NotificationPage } from './notifications';
import { fetchRtp } from './fairnessFeed';
import {
  fetchAgent,
  fetchAgentEligibility,
  fetchAgentPlayers,
  fetchAgentLinks,
  fetchSubAgents,
  fetchCommissionBreakdown,
  fetchCommissionSeries,
  fetchSettlements,
  setSubAgentRateApi,
  type AgentRange,
  createReferralLinkApi,
} from './agent';
import { fetchStats, fetchHistory, type HistoryPage, type StatsPeriod } from './stats';
import { fetchLobbyGames, fetchTables, type TableFilter } from './lobby';
import { useSession } from '@/store/session';
import { useContextStore } from '@/store/context';

/**
 * Server-data hooks.
 *
 * Every one is gated on being signed in. These endpoints are player-scoped, so
 * firing them while signed out would guarantee a 401 — which the client turns
 * into a session drop, so an unauthenticated screen would noisily log itself out
 * on mount. `enabled` keeps them quiet until there is a token.
 *
 * Query keys carry the playerId so switching accounts cannot show the previous
 * player's numbers from cache. On a shared device that would be a real leak.
 */

/**
 * The lobby rail. Public, so it needs no session — and unlike the player-scoped
 * hooks it works on staging today.
 *
 * Retried and refetched on an interval because these are live figures: player
 * counts and jackpots move while the screen is open. The lobby is also the first
 * screen most players see, so it gets one retry rather than failing to the
 * static fallback on a single flaky request.
 */
export function useLobbyGames() {
  // The context is part of the key, not just the request. Without it, switching
  // into a league would serve the cached PLATFORM rail — the isolation would
  // hold on the server and break in the cache.
  const leagueId = useContextStore((s) => s.leagueId);
  return useQuery({
    queryKey: ['lobby', 'games', leagueId],
    queryFn: () => fetchLobbyGames(leagueId),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useTables(filter: TableFilter = {}) {
  const leagueId = useContextStore((s) => s.leagueId);
  return useQuery({
    queryKey: ['lobby', 'tables', filter, leagueId],
    queryFn: () => fetchTables(filter, leagueId),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

export function useStats(period: StatsPeriod = 'all') {
  const playerId = useSession((s) => s.player?.playerId);

  return useQuery({
    queryKey: ['stats', playerId, period],
    queryFn: () => fetchStats(period),
    enabled: Boolean(playerId),
    // Stats move only when a hand settles, so a short window avoids refetching
    // on every visit to the tab without ever showing badly stale numbers.
    staleTime: 30_000,
  });
}

export function useHistory(period: StatsPeriod = 'all', pageSize = 20) {
  const playerId = useSession((s) => s.player?.playerId);

  return useInfiniteQuery<HistoryPage>({
    // period is part of the key: switching window must start a fresh pagination
    // rather than append a different window's rounds onto the current list.
    queryKey: ['history', playerId, period, pageSize],
    queryFn: ({ pageParam }) =>
      fetchHistory({
        limit: pageSize,
        period,
        ...(pageParam ? { cursor: String(pageParam) } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    // The server returns null once it has run out, which ends the pagination.
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(playerId),
    staleTime: 30_000,
  });
}

/**
 * Account settings.
 *
 * Reads are cached long — preferences change rarely, and a stale sound toggle
 * for a few minutes matters less than a request on every screen visit.
 */
export function useSettings() {
  const playerId = useSession((s) => s.player?.playerId);

  return useQuery({
    queryKey: ['settings', playerId],
    queryFn: fetchSettings,
    enabled: Boolean(playerId),
    staleTime: 5 * 60_000,
  });
}

/**
 * Writes a partial update, applied optimistically.
 *
 * A toggle that waits for a round-trip before moving feels broken, so the switch
 * flips immediately and rolls back if the server refuses. The server's response
 * is the settled state and overwrites the optimistic guess, so a rejected or
 * adjusted value cannot linger in the UI.
 */
export function useUpdateSettings() {
  const playerId = useSession((s) => s.player?.playerId);
  const queryClient = useQueryClient();
  const key = ['settings', playerId];

  return useMutation({
    mutationFn: (patch: SettingsPatch) => patchSettings(patch),
    onMutate: async (patch) => {
      // Stop an in-flight read from landing on top of the optimistic value.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PlayerSettings>(key);
      if (previous) queryClient.setQueryData<PlayerSettings>(key, { ...previous, ...patch });
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: (settled) => queryClient.setQueryData(key, settled),
  });
}

/**
 * Tables for the lobby list.
 *
 * Public, like the game rail, so no session is needed. Polled on an interval
 * because seats fill and empty while the screen is open — a lobby that is stale
 * sends players to a table that was full a minute ago.
 */
export function useLobbyTables(filter: TableFilter = {}) {
  const leagueId = useContextStore((s) => s.leagueId);
  return useQuery({
    // Filter AND context are part of the key: switching stake bucket, game type
    // or alliance must fetch, not re-slice a list fetched under other terms.
    queryKey: ['lobby', 'tables', filter, leagueId],
    queryFn: () => fetchTables(filter, leagueId),
    staleTime: 10_000,
    refetchInterval: 20_000,
    retry: 1,
  });
}

/** Reputation. Changes only on a settled round or an ops finding, so cached long. */
export function useReputation() {
  const playerId = useSession((s) => s.player?.playerId);

  return useQuery({
    queryKey: ['reputation', playerId],
    queryFn: fetchReputation,
    enabled: Boolean(playerId),
    staleTime: 60_000,
  });
}

/** Jackpot pools. Public, and polled — the headline figure should visibly move. */
export function useJackpot() {
  return useQuery({
    queryKey: ['jackpot'],
    queryFn: fetchJackpot,
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

/**
 * Past jackpot hits. Defaults to the last 30 days, per §5.
 *
 * Cached longer than the pools: a hit that already happened does not change,
 * and re-polling settled history every 30 seconds would be pure noise.
 */
export function useJackpotHistory(range?: { from?: string; to?: string; tier?: string }) {
  return useQuery({
    queryKey: ['jackpot', 'history', range ?? null],
    queryFn: () => fetchJackpotHistory(range),
    staleTime: 60_000,
    retry: 1,
  });
}

/** VIP standing. Moves only when a hand settles, so cached like reputation. */
export function useVip() {
  const playerId = useSession((s) => s.player?.playerId);

  return useQuery({
    queryKey: ['vip', playerId],
    queryFn: fetchVip,
    enabled: Boolean(playerId),
    staleTime: 60_000,
  });
}

// ── Alliances ───────────────────────────────────────────────────────────────

export function useMyLeagues() {
  const playerId = useSession((s) => s.player?.playerId);
  return useQuery({
    queryKey: ['leagues', 'mine', playerId],
    queryFn: fetchMyLeagues,
    enabled: Boolean(playerId),
    staleTime: 30_000,
  });
}

/** Public — browsing alliances should not need an account. */
export function useDiscoverLeagues() {
  return useQuery({ queryKey: ['leagues', 'discover'], queryFn: fetchLeagues, staleTime: 30_000 });
}

export function useCreateLeague() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createLeagueApi,
    // Both lists change: the new league is mine, and it becomes discoverable.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['leagues'] }),
  });
}

export function useJoinLeague() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: joinLeagueApi,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['leagues'] }),
  });
}

// ── Notifications ───────────────────────────────────────────────────────────

export function useNotifications(pageSize = 20) {
  const playerId = useSession((s) => s.player?.playerId);

  return useInfiniteQuery<NotificationPage>({
    queryKey: ['notifications', playerId, pageSize],
    queryFn: ({ pageParam }) =>
      fetchNotifications({
        limit: pageSize,
        ...(pageParam ? { cursor: String(pageParam) } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(playerId),
    staleTime: 15_000,
  });
}

/** Unread count alone, for the header badge — cheaper than holding the list. */
export function useUnreadCount() {
  const playerId = useSession((s) => s.player?.playerId);

  return useQuery({
    queryKey: ['notifications', 'unread', playerId],
    queryFn: () => fetchNotifications({ limit: 1 }).then((p) => p.unread),
    enabled: Boolean(playerId),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead(ids),
    // Refreshes both the list and the header badge.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

// ── Agent Center ────────────────────────────────────────────────────────────

const agentQuery = <T,>(key: string, fn: () => Promise<T>, playerId?: string) => ({
  queryKey: ['agent', key, playerId],
  queryFn: fn,
  enabled: Boolean(playerId),
  staleTime: 30_000,
});

export function useAgent() {
  const playerId = useSession((s) => s.player?.playerId);
  return useQuery(agentQuery('summary', fetchAgent, playerId));
}

export function useAgentEligibility() {
  const playerId = useSession((s) => s.player?.playerId);
  return useQuery(agentQuery('eligibility', fetchAgentEligibility, playerId));
}

export function useAgentPlayers() {
  const playerId = useSession((s) => s.player?.playerId);
  return useQuery(agentQuery('players', fetchAgentPlayers, playerId));
}

export function useAgentLinks() {
  const playerId = useSession((s) => s.player?.playerId);
  return useQuery(agentQuery('links', fetchAgentLinks, playerId));
}

export function useAgentSubAgents() {
  const playerId = useSession((s) => s.player?.playerId);
  return useQuery(agentQuery('sub-agents', fetchSubAgents, playerId));
}

export function useCreateReferralLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createReferralLinkApi,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['agent'] }),
  });
}

// Range-scoped reads. The range is part of the query key so switching period
// serves a cached answer instead of refetching, which is what §13.4's "switches
// without page reload" is asking for.

export function useCommissionBreakdown(range: AgentRange) {
  const playerId = useSession((s) => s.player?.playerId);
  return useQuery(
    agentQuery(`breakdown:${range}`, () => fetchCommissionBreakdown(range), playerId),
  );
}

export function useCommissionSeries(range: AgentRange) {
  const playerId = useSession((s) => s.player?.playerId);
  return useQuery(agentQuery(`series:${range}`, () => fetchCommissionSeries(range), playerId));
}

export function useSettlements(range: AgentRange, source?: 'DIRECT' | 'OVERRIDE') {
  const playerId = useSession((s) => s.player?.playerId);
  return useQuery(
    agentQuery(`settlements:${range}:${source ?? 'all'}`, () => fetchSettlements(range, source), playerId),
  );
}

export function useSetSubAgentRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ subAgentId, rateBps }: { subAgentId: string; rateBps: number }) =>
      setSubAgentRateApi(subAgentId, rateBps),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['agent'] }),
  });
}

/** Public payout rates. No session — the point is anyone can read them. */
export function useRtp() {
  return useQuery({ queryKey: ['fairness', 'rtp'], queryFn: fetchRtp, staleTime: 60_000, retry: 1 });
}
