import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { fetchStats, fetchHistory, type HistoryPage } from './stats';
import { fetchLobbyGames } from './lobby';
import { useSession } from '@/store/session';

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
  return useQuery({
    queryKey: ['lobby', 'games'],
    queryFn: fetchLobbyGames,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useStats() {
  const playerId = useSession((s) => s.player?.playerId);

  return useQuery({
    queryKey: ['stats', playerId],
    queryFn: fetchStats,
    enabled: Boolean(playerId),
    // Stats move only when a hand settles, so a short window avoids refetching
    // on every visit to the tab without ever showing badly stale numbers.
    staleTime: 30_000,
  });
}

export function useHistory(pageSize = 20) {
  const playerId = useSession((s) => s.player?.playerId);

  return useInfiniteQuery<HistoryPage>({
    queryKey: ['history', playerId, pageSize],
    queryFn: ({ pageParam }) =>
      fetchHistory({ limit: pageSize, ...(pageParam ? { cursor: String(pageParam) } : {}) }),
    initialPageParam: undefined as string | undefined,
    // The server returns null once it has run out, which ends the pagination.
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(playerId),
    staleTime: 30_000,
  });
}
