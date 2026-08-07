import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchSettings, patchSettings, type PlayerSettings, type SettingsPatch } from './settings';
import { fetchBalance } from './wallet';
import { fetchStats, fetchHistory, type HistoryPage, type StatsPeriod } from './stats';
import { fetchLobbyGames, fetchTables, type TableFilter } from './lobby';
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

export function useTables(filter: TableFilter = {}) {
  return useQuery({
    queryKey: ['lobby', 'tables', filter],
    queryFn: () => fetchTables(filter),
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

export function useBalance() {
  const { status } = useSession();
  const signedIn = status === 'authenticated';
  
  return useQuery({
    queryKey: ['balance'],
    queryFn: fetchBalance,
    enabled: signedIn,
    staleTime: 10 * 1000,
    retry: false,
  });
}
