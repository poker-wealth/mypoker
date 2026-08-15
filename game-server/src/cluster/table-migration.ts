/**
 * Table migration for the three-node topology (plan Day 13 — "table migration <500ms"). When a node
 * is drained or a client base shifts region, a live table moves to another node. This module is the
 * migration DATA CONTRACT + codec: the exact, versioned, restorable state of a table, and a
 * serialize/restore pair that is lossless and fast enough to leave the bulk of the 500ms budget for
 * network transfer.
 *
 * What migrates is only the EPHEMERAL game state — seats, stacks, and the in-flight hand. Money does
 * NOT migrate: player funds live in the Financial Core ledger, not the room (iron rule #1), so a
 * migration can never move, create, or lose a cent — it only relocates who is sitting where and whose
 * turn it is. The destination node re-attaches these seats and resumes the hand.
 *
 * Wiring room.exportSnapshot()/importSnapshot() to a live PokerRoom and shipping the blob over the
 * inter-node channel is the infra half; this is the contract + codec it plugs into, kept pure so it
 * is testable without a cluster.
 */

export const TABLE_SNAPSHOT_VERSION = 1 as const;

export interface SeatSnapshot {
  index: number;
  playerId: string;
  name: string;
  /** Chips at the seat. Mirrors the FC locked balance; the ledger remains the source of truth. */
  stack: number;
  sittingOut: boolean;
}

export interface TableSnapshot {
  version: typeof TABLE_SNAPSHOT_VERSION;
  tableId: string;
  gameId: string;
  /** Table configuration (blinds, rake, seat count …) — opaque here, owned by the game. */
  config: Record<string, unknown>;
  seats: SeatSnapshot[];
  /** The in-flight hand's engine-serialized state, or null between hands. Opaque to migration. */
  handState: unknown | null;
  /** Monotonic per-table sequence — the destination rejects an older snapshot than it already holds. */
  seq: number;
  /** Capture time (ms epoch). Passed in by the caller — this module never reads the clock. */
  capturedAt: number;
}

export class TableMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableMigrationError';
  }
}

/** Serialize a table snapshot to the wire form shipped between nodes. */
export function serializeSnapshot(snapshot: TableSnapshot): string {
  return JSON.stringify(snapshot);
}

/**
 * Parse + VALIDATE a snapshot from the wire. A migration must never restore a garbled or wrong-version
 * table — a bad blob is rejected loudly so the source keeps the table rather than the destination
 * bringing up a corrupt one. Validation is structural: shape, version, and per-seat field types.
 */
export function deserializeSnapshot(blob: string): TableSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(blob);
  } catch {
    throw new TableMigrationError('snapshot is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new TableMigrationError('snapshot is not an object');
  }
  const s = raw as Record<string, unknown>;
  if (s.version !== TABLE_SNAPSHOT_VERSION) {
    throw new TableMigrationError(`unsupported snapshot version: ${String(s.version)}`);
  }
  if (typeof s.tableId !== 'string' || typeof s.gameId !== 'string') {
    throw new TableMigrationError('snapshot missing tableId/gameId');
  }
  if (typeof s.seq !== 'number' || typeof s.capturedAt !== 'number') {
    throw new TableMigrationError('snapshot missing seq/capturedAt');
  }
  if (typeof s.config !== 'object' || s.config === null) {
    throw new TableMigrationError('snapshot missing config');
  }
  if (!Array.isArray(s.seats) || !s.seats.every(isSeatSnapshot)) {
    throw new TableMigrationError('snapshot has an invalid seat');
  }
  return {
    version: TABLE_SNAPSHOT_VERSION,
    tableId: s.tableId,
    gameId: s.gameId,
    config: s.config as Record<string, unknown>,
    seats: s.seats as SeatSnapshot[],
    handState: 'handState' in s ? (s.handState ?? null) : null,
    seq: s.seq,
    capturedAt: s.capturedAt,
  };
}

/**
 * Should the destination accept this snapshot over what it already holds? A migration must be
 * strictly forward: an equal-or-older seq is a stale/duplicate delivery and is refused, so a
 * re-delivered snapshot can never roll a table back to an earlier hand.
 */
export function isNewerSnapshot(incoming: TableSnapshot, currentSeq: number | undefined): boolean {
  return currentSeq === undefined || incoming.seq > currentSeq;
}

function isSeatSnapshot(v: unknown): v is SeatSnapshot {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.index === 'number' &&
    typeof s.playerId === 'string' &&
    typeof s.name === 'string' &&
    typeof s.stack === 'number' &&
    typeof s.sittingOut === 'boolean'
  );
}
