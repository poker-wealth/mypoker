import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TableSocket, type SocketStatus } from './tableSocket';
import { getSocketBase } from '../apiConfig';
import type { TableCommand, TableSnapshot } from '../lib/liveTable';

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

  return { snapshot, status, error, socket, command: (cmd) => socketRef.current?.send(cmd) };
}
