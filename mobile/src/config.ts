import { Platform } from 'react-native';

/**
 * Where the app talks to.
 *
 * Mirrors frontend/src/config.ts, with one difference that bites immediately: `localhost` on a
 * phone means the PHONE, not your laptop. An Android emulator reaches the host at 10.0.2.2; a real
 * device needs the machine's LAN address, which no default can guess — set EXPO_PUBLIC_TABLES_URL
 * for that case.
 */

/** The dev host as seen from wherever the app is running. */
const devHost = (): string => {
  if (Platform.OS === 'android') return '10.0.2.2'; // the emulator's alias for the host machine
  return '127.0.0.1'; // iOS simulator and web share the host's loopback
};

/** The gateway: auth, lobby, wallet. */
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? `http://${devHost()}:4100`
).replace(/\/$/, '');

/** The live tables server. Separate today; folds into the gateway later, exactly as on web. */
export const TABLES_URL = (
  process.env.EXPO_PUBLIC_TABLES_URL ?? `http://${devHost()}:4200`
).replace(/\/$/, '');

/** The game socket, derived from the tables origin. */
export const TABLES_WS_URL =
  process.env.EXPO_PUBLIC_TABLES_WS_URL ?? `${TABLES_URL.replace(/^http/, 'ws')}/ws`;

/**
 * Tables with a screen behind them.
 *
 * Kept in step with `frontend/src/components/games/registry.ts`. A table id missing here has no
 * felt yet, so the lobby says so rather than opening a blank screen — the web app learned that one
 * the hard way when a lost registry sent every game to the poker table.
 */
export const PORTED_TABLES: ReadonlySet<string> = new Set([
  'texas',
  'texas-high',
  'short-deck',
  'omaha',
]);
