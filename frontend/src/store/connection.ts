import { create } from 'zustand';
import { setReachabilityHandler } from '@/api/client';

/**
 * Whether the app can reach the network.
 *
 * `navigator.onLine` alone is not enough — it reports whether the device has a
 * network interface, not whether anything is reachable, so captive portals and
 * dead mobile data both read as "online". So this tracks two things: the
 * browser's own signal, and whether our own requests are actually succeeding.
 * The banner shows if either says no.
 */

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting';

interface ConnectionState {
  /** navigator.onLine, kept current by the online/offline events. */
  browserOnline: boolean;
  /** Set when an API call fails to reach the server at all. */
  requestsFailing: boolean;
  status: ConnectionStatus;
  setBrowserOnline: (online: boolean) => void;
  setRequestsFailing: (failing: boolean) => void;
}

function derive(browserOnline: boolean, requestsFailing: boolean): ConnectionStatus {
  if (!browserOnline) return 'offline';
  // The device says it has a connection but our requests aren't landing —
  // "reconnecting" rather than "offline", because it may well come back on its
  // own and telling the player they're offline would be wrong.
  if (requestsFailing) return 'reconnecting';
  return 'online';
}

export const useConnection = create<ConnectionState>((set, get) => ({
  browserOnline: navigator.onLine,
  requestsFailing: false,
  status: derive(navigator.onLine, false),

  setBrowserOnline: (online) => {
    const { requestsFailing } = get();
    // Coming back from offline clears the failure flag: the next request gets a
    // clean shot rather than the banner sticking until something happens to retry.
    const failing = online ? false : requestsFailing;
    set({ browserOnline: online, requestsFailing: failing, status: derive(online, failing) });
  },

  setRequestsFailing: (failing) => {
    const { browserOnline } = get();
    set({ requestsFailing: failing, status: derive(browserOnline, failing) });
  },
}));

/**
 * Wire up both signals. Called once at startup.
 *
 * Imports the client rather than the other way round: the client stays free of
 * store dependencies (the session store already logs in through it, and a cycle
 * there would be genuinely awkward to unpick).
 */
export function watchConnection(): void {
  const update = (): void => useConnection.getState().setBrowserOnline(navigator.onLine);
  window.addEventListener('online', update);
  window.addEventListener('offline', update);

  setReachabilityHandler((reachable) => {
    useConnection.getState().setRequestsFailing(!reachable);
  });
}
