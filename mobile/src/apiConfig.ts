import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

/**
 * Where the gateway lives, and — in `device` builds only — where a tester can
 * point it instead.
 *
 * There is no deployed API for physical-device testing: the phone reaches a
 * local gateway through a tunnel (e.g. `cloudflared tunnel --url
 * http://localhost:4100`) that hands out a new https URL every session.
 * `EXPO_PUBLIC_API_URL` is inlined at build time, so a fresh tunnel URL would
 * otherwise mean a full rebuild each time. The override below lets a `device`
 * build read the base URL at runtime instead, without touching any other
 * build's behaviour.
 */

const OVERRIDE_KEY = 'mypoker.api.override';

/**
 * Set ONLY by the `device` EAS profile (see eas.json). Production, preview and
 * development builds never set `EXPO_PUBLIC_ALLOW_API_OVERRIDE`, so this is
 * `false` there and the override can never be shown or used. It is a
 * build-time constant, so the UI it gates (`ApiUrlField`) is stripped from
 * every other build, not just hidden at runtime.
 */
export const OVERRIDE_ALLOWED = process.env.EXPO_PUBLIC_ALLOW_API_OVERRIDE === 'true';

/**
 * Where the gateway lives.
 *
 * `EXPO_PUBLIC_` is inlined at build time by Expo. On an Android emulator the
 * host machine is `10.0.2.2` — `localhost` there means the emulator itself,
 * which is the single most common "why does nothing load" on this platform.
 */
export const BUILD_API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

/**
 * A cached copy, because `getApiBase()` is called on every request and
 * SecureStore is a native round-trip. `undefined` means "not read yet"; `null`
 * means "read, and there is none" — a distinction that matters, or a cold
 * start looks identical to "no override" and we would keep re-reading storage.
 */
let cached: string | null | undefined;

export async function getApiOverride(): Promise<string | null> {
  if (!OVERRIDE_ALLOWED) return null;
  if (cached !== undefined) return cached;
  try {
    cached = (await SecureStore.getItemAsync(OVERRIDE_KEY)) ?? null;
  } catch {
    // A keychain read can fail on a locked device. Treat it as "no override"
    // for this attempt but do NOT cache the failure as an answer — the next
    // call should try again rather than inherit a wrong null for the session.
    return null;
  }
  return cached;
}

export async function setApiOverride(url: string): Promise<void> {
  if (!OVERRIDE_ALLOWED) return;
  const trimmed = url.trim().replace(/\/$/, '');
  cached = trimmed;
  await SecureStore.setItemAsync(OVERRIDE_KEY, trimmed);
}

export async function clearApiOverride(): Promise<void> {
  if (!OVERRIDE_ALLOWED) return;
  cached = null;
  await SecureStore.deleteItemAsync(OVERRIDE_KEY).catch(() => {
    // Already gone, or the keychain is unavailable. The in-memory clear above
    // is what stops this process using it; a failed delete is not worth
    // throwing at a tester who is just resetting a field.
  });
}

/** The base URL a request should use: the override if one is set, else the build-time value. */
export async function getApiBase(): Promise<string> {
  const override = await getApiOverride();
  return override ?? BUILD_API_URL;
}

/**
 * The WebSocket origin for the API base actually in use.
 *
 * The table socket must resolve the SAME base as every REST call. Reading
 * the build-time constant instead produced `"/ws"` in `device` builds — an
 * invalid URL — so REST worked through the runtime override while every
 * table silently failed to connect.
 *
 * Returns null when no base is configured, so the caller can say so rather
 * than opening a socket to a nonsense address.
 */
export async function getSocketBase(): Promise<string | null> {
  const base = await getApiBase();
  if (!base) return null;
  return `${base.replace(/^http/, 'ws')}/ws`;
}

/**
 * The API base actually in use, resolved once on mount.
 *
 * Displays must show the EFFECTIVE base, not the build-time constant: in a
 * `device` build the baked value is empty and the real one is set at runtime,
 * so showing the constant reports "not set" next to a perfectly working
 * connection — a lie told precisely when someone is debugging a connection.
 *
 * Not reactive to later overrides; the field that sets one already tells the
 * user to restart.
 */
export function useApiBase(): string | null {
  const [base, setBase] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getApiBase().then((b) => {
      if (alive) setBase(b);
    });
    return () => {
      alive = false;
    };
  }, []);

  return base;
}
