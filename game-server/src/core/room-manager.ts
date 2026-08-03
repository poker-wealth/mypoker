/**
 * RoomManager — table/room lifecycle and seating.
 *
 * Owns the registry of live rooms, seats players up to the game's capacity, and enforces the
 * one-table-per-player rule at the framework level (the foundation of the anti-bot single-table
 * limit, FairPlay §8.1). A room holds its game instance; game logic stays in the game.
 */

export interface GameLike {
  readonly minPlayers: number;
  readonly maxPlayers: number;
}

export interface Room<G extends GameLike> {
  id: string;
  game: G;
  players: string[];
  createdAt: number;
}

export class RoomError extends Error {}
export class RoomExistsError extends RoomError {
  constructor(id: string) {
    super(`Room already exists: ${id}`);
  }
}
export class RoomNotFoundError extends RoomError {
  constructor(id: string) {
    super(`Room not found: ${id}`);
  }
}
export class RoomFullError extends RoomError {
  constructor(id: string) {
    super(`Room is full: ${id}`);
  }
}
export class AlreadySeatedError extends RoomError {
  constructor(playerId: string) {
    super(`Player already seated at a table: ${playerId}`);
  }
}

export class RoomManager<G extends GameLike> {
  private readonly rooms = new Map<string, Room<G>>();
  /** playerId → roomId, enforcing one active table per player (anti-bot single-table limit). */
  private readonly playerRoom = new Map<string, string>();

  create(id: string, game: G): Room<G> {
    if (this.rooms.has(id)) throw new RoomExistsError(id);
    const room: Room<G> = { id, game, players: [], createdAt: Date.now() };
    this.rooms.set(id, room);
    return room;
  }

  get(id: string): Room<G> {
    const room = this.rooms.get(id);
    if (!room) throw new RoomNotFoundError(id);
    return room;
  }

  has(id: string): boolean {
    return this.rooms.has(id);
  }

  /** Seat a player. Rejects if the room is full or the player is already at another table. */
  join(id: string, playerId: string): Room<G> {
    const room = this.get(id);
    if (room.players.includes(playerId)) return room;
    if (this.playerRoom.has(playerId)) throw new AlreadySeatedError(playerId);
    if (room.players.length >= room.game.maxPlayers) throw new RoomFullError(id);
    room.players.push(playerId);
    this.playerRoom.set(playerId, id);
    return room;
  }

  leave(id: string, playerId: string): Room<G> {
    const room = this.get(id);
    room.players = room.players.filter((p) => p !== playerId);
    if (this.playerRoom.get(playerId) === id) this.playerRoom.delete(playerId);
    return room;
  }

  remove(id: string): void {
    const room = this.rooms.get(id);
    if (!room) return;
    for (const p of room.players) this.playerRoom.delete(p);
    this.rooms.delete(id);
  }

  /** The room a player is currently seated at, if any. */
  roomOf(playerId: string): string | undefined {
    return this.playerRoom.get(playerId);
  }

  list(): Room<G>[] {
    return [...this.rooms.values()];
  }

  get size(): number {
    return this.rooms.size;
  }
}
