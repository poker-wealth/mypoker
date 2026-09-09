import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Which system the player is currently looking at — the platform lobby, or one
 * of their alliances (FairPlay v5.9 §2, iron rule 6).
 *
 * The two are absolutely isolated: a league's private rooms never appear in the
 * public lobby, and inside a league you see that league's tables and its wallet
 * rather than the platform's. This store is only the client's memory of which
 * one is selected — the server enforces the isolation and re-checks membership
 * on every read.
 *
 * Persisted so switching tabs or reopening the app does not silently drop a
 * player back into the platform lobby mid-session.
 */

interface ContextState {
  /** null = the public platform lobby. */
  leagueId: string | null;
  leagueName: string | null;
  enterLeague: (leagueId: string, leagueName: string) => void;
  leavePlatformContext: () => void;
  /** Drop the context if the player is no longer a member of that league. */
  leaveContextIfGone: (myLeagueIds: readonly string[]) => void;
}

export const useContextStore = create<ContextState>()(
  persist(
    (set, get) => ({
      leagueId: null,
      leagueName: null,
      enterLeague: (leagueId, leagueName) => set({ leagueId, leagueName }),
      leavePlatformContext: () => set({ leagueId: null, leagueName: null }),
      leaveContextIfGone: (myLeagueIds) => {
        const current = get().leagueId;
        if (current && !myLeagueIds.includes(current)) {
          set({ leagueId: null, leagueName: null });
        }
      },
    }),
    {
      name: 'mypoker.context',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/** The query-string fragment every context-scoped read appends. */
export const contextParam = (leagueId: string | null): string =>
  leagueId ? `leagueId=${encodeURIComponent(leagueId)}` : '';
