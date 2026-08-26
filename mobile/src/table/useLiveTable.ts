import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as SecureStore from 'expo-secure-store';
import { getRandomBytesAsync } from 'expo-crypto';
import { TableSocket, type SocketStatus } from './tableSocket';
import { getSocketBase } from '../apiConfig';
import { useAuth } from '../auth';
import type { TableCommand, TableSnapshot } from '../lib/liveTable';

/**
 * This device's own entropy contribution to the provably-fair shuffle — the native port of
 * `frontend/src/lib/clientSeed.ts`. The web persists it in `localStorage`, which doesn't exist
 * here; this mirrors `session.ts`'s read-once-cache-in-memory approach against SecureStore
 * instead, kept local to this file rather than added to session.ts because this fix may only
 * touch TableScreen.tsx and this file. Not gated behind AFTER_FIRST_UNLOCK like the session token
 * is — a client seed authorises nothing and moves no money, so the extra keychain restriction
 * session.ts applies to the token would be unearned caution here.
 */
const CLIENT_SEED_KEY = 'mypoker.clientSeed';
const HEX64 = /^[0-9a-f]{64}$/;

/** Cached copy once minted or read back, so repeated sits (and re-renders) don't re-touch the
 *  keychain or, worse, mint a second seed — the whole point is that it stays STABLE per install. */
let cachedClientSeed: string | null = null;

async function deviceClientSeed(): Promise<string> {
  if (cachedClientSeed) return cachedClientSeed;
  try {
    const existing = await SecureStore.getItemAsync(CLIENT_SEED_KEY);
    if (existing && HEX64.test(existing)) {
      cachedClientSeed = existing;
      return existing;
    }
  } catch {
    // A locked keychain fails the read; fall through and mint one for this attempt rather than
    // giving up on sending entropy at all for the sit that triggered this.
  }
  // expo-crypto, not Math.random: the server must never be able to predict or influence this
  // value, which is the entire premise of "the player's own entropy" (fairness spec v6.0 §6).
  const bytes = await getRandomBytesAsync(32);
  let seed = '';
  for (const b of bytes) seed += b.toString(16).padStart(2, '0');
  cachedClientSeed = seed;
  try {
    await SecureStore.setItemAsync(CLIENT_SEED_KEY, seed);
  } catch {
    // Persistence failed — the in-memory cache above still keeps it stable for the rest of this
    // run. A seed that doesn't survive a restart is a fairness footnote, not a broken table.
  }
  return seed;
}

/**
 * A live table, as one hook.
 *
 * Mirrors `frontend/src/hooks/useLiveTable.ts`: open the socket, hold the latest snapshot, send
 * commands. Everything on screen is the server's answer — this never computes a stack, a pot or a
 * legal move of its own.
 *
 * The socket URL is resolved through `getSocketBase()` — the SAME effective base every REST call
 * uses (override included). Reading the build-time constant here once produced `"/ws"` on `device`
 * builds and every table silently failed to connect while the rest of the app worked fine.
 */

export interface LiveTable {
  snapshot: TableSnapshot | null;
  status: SocketStatus;
  error: string | null;
  command: (cmd: TableCommand) => void;
  /**
   * The live socket, or null before it exists.
   *
   * Exposed because not everything the table sends is in the snapshot: chat and the bot-check
   * prompt arrive as EVENTS, and a snapshot-only hook cannot see them. Held as state rather than
   * returned from the ref so that subscribers re-run when the socket is replaced — a ref would hand
   * them the old one and their listeners would attach to a dead connection.
   */
  socket: TableSocket | null;
}

export function useLiveTable(tableId: string, token: string | null): LiveTable {
  const { t } = useTranslation();
  const { player } = useAuth();
  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<TableSocket | null>(null);
  const socketRef = useRef<TableSocket | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('closed');
      setSocket(null);
      return;
    }

    // getSocketBase() is a native round-trip (SecureStore), so the socket cannot be built
    // synchronously here the way it used to be. `cancelled` stops a resolve that lands after this
    // effect has already torn down (unmount, or tableId/token changed) from opening a socket nobody
    // will ever close.
    let cancelled = false;

    void getSocketBase().then((base) => {
      if (cancelled) return;

      if (!base) {
        // No build-time URL and no runtime override — there is nowhere to open a socket to. This is
        // not the server refusing us, so it belongs on the same error channel as a real connection
        // failure rather than leaving the screen stuck on "connecting" forever.
        setStatus('error');
        setError(t('table.connectionLost'));
        return;
      }

      const next = new TableSocket(base, token, tableId, {
        onSnapshot: (s) => {
          setSnapshot(s);
          setError(null);
        },
        onStatus: setStatus,
        onError: setError,
      });
      socketRef.current = next;
      setSocket(next);
      next.connect();
    });

    return () => {
      cancelled = true;
      socketRef.current?.close();
      socketRef.current = null;
      setSocket(null);
    };
  }, [tableId, token, t]);

  /**
   * Every command funnels through here — including bare `{kind:'sit'}` from felts that know
   * nothing about who's signed in (BaccaratFelt.tsx and others). Attaching identity and entropy
   * HERE, once, rather than in each felt, means none of them can forget it and no felt has to be
   * touched to fix it.
   */
  const command = (cmd: TableCommand): void => {
    if (cmd.kind === 'sit') {
      // Name and photo travel with the request because the gateway keeps no player rows — they
      // label the seat and nothing more. Sent only when known: a profile that hasn't loaded yet
      // must not make up a name, and the server already falls back to "Player N" on its own
      // (game-server/src/live/players.ts) when neither is sent. Mirrors
      // frontend/src/hooks/useLiveTable.ts's `sit`.
      socketRef.current?.send({
        ...cmd,
        ...(player?.displayName ? { name: player.displayName.slice(0, 24) } : {}),
        ...(player?.photoUrl ? { avatarUrl: player.photoUrl } : {}),
      });
      // Register this device's own client seed the moment we're seated, so every deal from here
      // uses the player's entropy, not just the server's — otherwise the fairness verifier's "your
      // own seed survived into the deal" step (fairness.ts, spec v6.0 §6) can never pass for this
      // player's own hands. Sent as a second command rather than folded into `sit`'s schema: the
      // server requires the seat to exist first (texas-game.ts's setClientSeed checks the caller is
      // seated), and these two frames are processed in the order this socket sends them.
      void deviceClientSeed().then((seed) => {
        socketRef.current?.send({ kind: 'set_client_seed', seed });
      });
      return;
    }
    socketRef.current?.send(cmd);
  };

  return { snapshot, status, error, socket, command };
}
