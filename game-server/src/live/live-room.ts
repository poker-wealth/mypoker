import type { PlayerDirectory } from './players';
import type { FinancialCoreClient } from '../core/financial-core-client';
import type { ChainClient } from '../fairness';
import type { TableCommand, TableSnapshot, TableSummary } from './room-state';
import type { GameId } from '../lobby/game-catalog';

/**
 * The seam between the transport and a game's live table.
 *
 * `TableHub` owns the socket, the seating fan-out and the one-table-at-a-time rule; it speaks to a
 * table only through `LiveRoom` — six methods, the same for every game. So a new game becomes
 * reachable by (1) implementing `LiveRoom` for it and (2) registering a factory here. Poker,
 * baccarat, niu niu and the rest each bring their own flow behind this interface; nothing in the
 * hub or the transport changes. Money still moves only through `deps.fc` (iron rule #3).
 */

/** How a live room pushes state and events to one connected client. */
export interface RoomSink {
  sendSnapshot: (snapshot: TableSnapshot) => void;
  sendEvent: (event: string, data: unknown) => void;
}

/** Everything a live room needs from the outside world — identical for every game. */
export interface RoomDeps {
  directory: PlayerDirectory;
  /** The ONLY route money takes (iron rule #3): play chips in dev, the real ledger in production. */
  fc: FinancialCoreClient;
  chain?: ChainClient;
}

/** The contract `TableHub` drives, and the one thing every game's live room must satisfy. */
export interface LiveRoom {
  /** Subscribe a client to snapshots/events; returns an unsubscribe function. */
  join(playerId: string, client: RoomSink): () => void;
  /** Apply a player command (sit / act / stand / …). Rejects illegal moves; never trusts the client. */
  command(playerId: string, command: TableCommand): Promise<void>;
  /** The snapshot this player is allowed to see — their own cards, never an opponent's. */
  snapshotFor(playerId: string): TableSnapshot;
  /** The lobby row for this table. */
  summary(): TableSummary;
  /** Is this player seated here right now? (the hub uses this to enforce one table at a time.) */
  hasSeated(playerId: string): boolean;
  /** Stop timers and release resources. */
  dispose(): void;
}

/** The minimum every table config carries; `game` selects the room implementation. */
export interface LiveTableConfig {
  id: string;
  name: string;
  game: GameId;
}

/** Builds a room for one table. Each game registers exactly one. */
export type RoomFactory = (config: LiveTableConfig, deps: RoomDeps) => LiveRoom;

const registry = new Map<GameId, RoomFactory>();

/** Register the room implementation for a game. Called once at startup — see `rooms.ts`. */
export function registerRoom(game: GameId, factory: RoomFactory): void {
  registry.set(game, factory);
}

/** Build the right room for a table config. Throws if that game has no room registered yet. */
export function createRoom(config: LiveTableConfig, deps: RoomDeps): LiveRoom {
  const factory = registry.get(config.game);
  if (!factory) {
    throw new Error(`no live room registered for game "${config.game}" — add one in live/rooms.ts`);
  }
  return factory(config, deps);
}

/** Which games can currently be hosted (have a registered room). */
export function hostableGames(): GameId[] {
  return [...registry.keys()];
}
