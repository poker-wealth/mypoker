import * as SecureStore from 'expo-secure-store';

/**
 * The session token — the seam between the shell and everything else.
 *
 * The shell owns identity: it obtains the token, stores it, and hands it out.
 * The game side (felts, live-table socket) asks for it and never stores its
 * own copy. Two stores would drift, and the one that drifted would fail at a
 * table mid-hand.
 *
 * WHY SECURE STORE AND NOT AsyncStorage
 *
 * This token authorises money: buy-ins, withdrawals, admin actions. AsyncStorage
 * is plain files in the app sandbox — readable on a rooted or jailbroken device
 * and swept up by device backups. SecureStore is the Keychain on iOS and
 * EncryptedSharedPreferences on Android.
 *
 * That does NOT make a compromised device safe, which is exactly why the spec
 * requires root/jailbreak detection before real money. Storage is one layer;
 * refusing to run on a compromised device is the other.
 */

const TOKEN_KEY = 'mypoker.session.token';

/**
 * A cached copy, because the socket asks for the token on every reconnect and
 * SecureStore is a native round-trip. `undefined` means "not read yet"; `null`
 * means "read, and there is none" — a distinction that matters, or a cold start
 * looks identical to a signed-out user and we would clear a session that exists.
 */
let cached: string | null | undefined;

/**
 * Notified whenever the token is dropped, including by api.ts on a 401.
 *
 * Without this the shell keeps rendering a signed-in app over a session the
 * server has already forgotten: the token is gone from storage but the auth
 * context still says 'signedIn', so every screen errors and nothing routes the
 * player back to sign-in. A Set rather than a single callback so the provider
 * can subscribe and unsubscribe cleanly across remounts.
 */
const sessionLostListeners = new Set<() => void>();

/** Subscribe to session loss. Returns the unsubscribe function. */
export function onSessionLost(fn: () => void): () => void {
  sessionLostListeners.add(fn);
  return () => sessionLostListeners.delete(fn);
}

export async function getToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    cached = (await SecureStore.getItemAsync(TOKEN_KEY)) ?? null;
  } catch {
    // A keychain read can fail on a locked device. Treat it as "no token" for
    // this attempt but do NOT cache the failure as an answer — the next call
    // should try again rather than inherit a wrong null for the whole session.
    return null;
  }
  return cached;
}

export async function setToken(token: string): Promise<void> {
  cached = token;
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    // Only after the device has been unlocked once since boot: background work
    // must not be able to read it while the phone is locked in a pocket.
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function clearToken(): Promise<void> {
  cached = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {
    // Already gone, or the keychain is unavailable. The in-memory clear above
    // is what stops this process using it; a failed delete is not worth
    // throwing at a user who is signing out.
  });
  // Notify last: the token must actually be gone — from the cache and from
  // storage — before anyone reacts to its going, or a listener that reads the
  // token back (directly or via getToken) could still see the old value.
  for (const fn of sessionLostListeners) {
    try {
      fn();
    } catch {
      // One listener throwing must not stop the others from being notified.
    }
  }
}

/** True when a token exists. Says nothing about whether the SERVER still accepts it. */
export async function hasSession(): Promise<boolean> {
  return (await getToken()) !== null;
}

/**
 * The signed-in player, cached beside the token.
 *
 * WHY THIS EXISTS
 *
 * `AuthProvider` learns who you are from the sign-in RESPONSE and holds it in memory. On a cold
 * start it only reads the token back, so `player` is null while `status` is 'signedIn' — and the
 * account screen greeted a signed-in player as "Guest Player" with no id.
 *
 * `/auth/me` is not the fix on its own: it returns `displayName: playerId`, a placeholder rather
 * than the name the user actually has. Caching the real profile from sign-in preserves it.
 *
 * This is a CACHE, never an authority. It says who we last signed in as, not that the session is
 * still valid — only the server decides that, and a 401 clears both.
 */
const PLAYER_KEY = 'mypoker.session.player';

export async function setCachedPlayer(player: unknown): Promise<void> {
  try {
    await SecureStore.setItemAsync(PLAYER_KEY, JSON.stringify(player), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  } catch {
    // A profile we cannot cache is a cosmetic loss on the next cold start, not a failed sign-in.
  }
}

export async function getCachedPlayer<T>(): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(PLAYER_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function clearCachedPlayer(): Promise<void> {
  await SecureStore.deleteItemAsync(PLAYER_KEY).catch(() => {});
}
