import { useEffect, useRef, useState } from 'react';
import { TableSocket, type SocketStatus } from '../api/tableSocket';
import { TABLES_WS_URL } from '../config';
import type { TableCommand, TableSnapshot } from '../lib/liveTable';

/**
 * A live table, as one hook.
 *
 * Mirrors `frontend/src/hooks/useLiveTable.ts`: open the socket, hold the latest snapshot, expose a
 * way to send commands. Everything on screen is the server's answer — this never computes a stack,
 * a pot or a legal move of its own.
 */
export interface LiveTable {
  snapshot: TableSnapshot | null;
  status: SocketStatus;
  error: string | null;
  command: (cmd: TableCommand) => void;
}

export function useLiveTable(tableId: string, token: string | null): LiveTable {
  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<TableSocket | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('closed');
      return;
    }

    const socket = new TableSocket(TABLES_WS_URL, token, tableId, {
      onSnapshot: (next) => {
        setSnapshot(next);
        setError(null);
      },
      onStatus: setStatus,
      onError: setError,
    });
    socketRef.current = socket;
    socket.connect();

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [tableId, token]);

  return {
    snapshot,
    status,
    error,
    command: (cmd) => socketRef.current?.send(cmd),
  };
}
