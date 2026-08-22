import { useEffect, useRef, useState } from 'react';
import { TableSocket, type SocketStatus } from './tableSocket';
import { API_URL } from '../api';
import type { TableCommand, TableSnapshot } from '../lib/liveTable';

/**
 * A live table, as one hook.
 *
 * Mirrors `frontend/src/hooks/useLiveTable.ts`: open the socket, hold the latest snapshot, send
 * commands. Everything on screen is the server's answer — this never computes a stack, a pot or a
 * legal move of its own.
 *
 * The socket URL is the gateway's, with the scheme swapped and `/ws` appended, exactly as the web
 * client derives it. One API URL, not a second one to keep in step.
 */

export const socketUrl = (): string => `${API_URL.replace(/^http/, 'ws')}/ws`;

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

    const next = new TableSocket(socketUrl(), token, tableId, {
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

    return () => {
      next.close();
      socketRef.current = null;
      setSocket(null);
    };
  }, [tableId, token]);

  return { snapshot, status, error, socket, command: (cmd) => socketRef.current?.send(cmd) };
}
