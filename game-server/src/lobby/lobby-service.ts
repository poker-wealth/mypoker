import { GAME_IDS, gameSpec, type FairnessTier, type GameId } from './game-catalog';

/**
 * LobbyService — what a player sees before they sit down.
 *
 * Holds the live table registry, aggregates each game's jackpot across all its active tables,
 * filters tables, and gates any table that has too few players ("Waiting for players" — a table
 * below its minimum never auto-starts). A game whose outside vendor is down is surfaced as
 * UNAVAILABLE rather than allowed to fail at the table.
 */

export type TableStatus = 'UNAVAILABLE' | 'WAITING' | 'OPEN' | 'FULL';

export interface LobbyTable {
  id: string;
  gameId: GameId;
  /** Table stake level (e.g. big blind / base bet). */
  stakes: number;
  players: number;
  /** This table's accumulated jackpot. */
  jackpot: number;
  /**
   * Minimum buy-in, expressed in big blinds.
   *
   * In big blinds rather than currency because that is how players compare
   * tables — 40BB is the same depth whether the blinds are 1/2 or 100/200, and a
   * cash figure would have to be re-read against the stakes column every time.
   */
  buyInBB: number;
}

export interface TableView extends LobbyTable {
  name: string;
  status: TableStatus;
  minPlayers: number;
  maxPlayers: number;
  fairness: FairnessTier;
  vendor?: string;
  seatsFree: number;
  /** Set when the table cannot start, so the UI has the reason to show. */
  waitingFor?: number;
}

export interface GameSummary {
  gameId: GameId;
  name: string;
  fairness: FairnessTier;
  vendor?: string;
  available: boolean;
  tables: number;
  players: number;
  /** Sum of the jackpots of every active table of this game type. */
  jackpot: number;
}

export interface TableFilter {
  gameId?: GameId;
  minStakes?: number;
  maxStakes?: number;
  /** Only tables with at least one free seat. */
  hasSeats?: boolean;
  minJackpot?: number;
  /** Only tables that can actually start right now. */
  readyOnly?: boolean;
  fairness?: FairnessTier;
}

export class LobbyService {
  private readonly tables = new Map<string, LobbyTable>();
  /** Games taken offline because their vendor is down. */
  private readonly unavailable = new Set<GameId>();

  addTable(table: LobbyTable): void {
    gameSpec(table.gameId); // reject unknown games at the door
    this.tables.set(table.id, { ...table });
  }

  removeTable(tableId: string): void {
    this.tables.delete(tableId);
  }

  /** Keep the lobby in step with the live table (seat counts, jackpot growth). */
  updateTable(tableId: string, patch: Partial<Pick<LobbyTable, 'players' | 'jackpot' | 'stakes'>>): void {
    const t = this.tables.get(tableId);
    if (!t) throw new RangeError(`unknown table: ${tableId}`);
    Object.assign(t, patch);
  }

  /** Mark a game up or down — driven by the vendor circuit breaker's `isAvailable()`. */
  setAvailability(gameId: GameId, available: boolean): void {
    gameSpec(gameId);
    if (available) this.unavailable.delete(gameId);
    else this.unavailable.add(gameId);
  }

  isAvailable(gameId: GameId): boolean {
    return !this.unavailable.has(gameId);
  }

  private statusOf(t: LobbyTable): TableStatus {
    const spec = gameSpec(t.gameId);
    if (!this.isAvailable(t.gameId)) return 'UNAVAILABLE';
    if (t.players >= spec.maxPlayers) return 'FULL';
    if (t.players < spec.minPlayers) return 'WAITING';
    return 'OPEN';
  }

  private viewOf(t: LobbyTable): TableView {
    const spec = gameSpec(t.gameId);
    const status = this.statusOf(t);
    return {
      ...t,
      name: spec.name,
      status,
      minPlayers: spec.minPlayers,
      maxPlayers: spec.maxPlayers,
      fairness: spec.fairness,
      ...(spec.vendor ? { vendor: spec.vendor } : {}),
      seatsFree: Math.max(0, spec.maxPlayers - t.players),
      ...(status === 'WAITING' ? { waitingFor: spec.minPlayers - t.players } : {}),
    };
  }

  getTable(tableId: string): TableView | undefined {
    const t = this.tables.get(tableId);
    return t ? this.viewOf(t) : undefined;
  }

  /**
   * A table may only start when its game is up and it has met its minimum.
   * Below minimum it shows "Waiting for players" and does NOT auto-start.
   */
  canStart(tableId: string): boolean {
    const t = this.tables.get(tableId);
    return t ? this.statusOf(t) === 'OPEN' || this.statusOf(t) === 'FULL' : false;
  }

  listTables(filter: TableFilter = {}): TableView[] {
    return [...this.tables.values()]
      .map((t) => this.viewOf(t))
      .filter((v) => {
        if (filter.gameId && v.gameId !== filter.gameId) return false;
        if (filter.minStakes !== undefined && v.stakes < filter.minStakes) return false;
        if (filter.maxStakes !== undefined && v.stakes > filter.maxStakes) return false;
        if (filter.hasSeats && v.seatsFree === 0) return false;
        if (filter.minJackpot !== undefined && v.jackpot < filter.minJackpot) return false;
        if (filter.readyOnly && v.status !== 'OPEN' && v.status !== 'FULL') return false;
        if (filter.fairness && v.fairness !== filter.fairness) return false;
        return true;
      })
      .sort((a, b) => b.jackpot - a.jackpot || b.players - a.players || a.id.localeCompare(b.id));
  }

  /** The lobby's game rail: one row per game type, with its pooled jackpot across all tables. */
  listGames(): GameSummary[] {
    return GAME_IDS.map((gameId) => {
      const spec = gameSpec(gameId);
      const tables = [...this.tables.values()].filter((t) => t.gameId === gameId);
      return {
        gameId,
        name: spec.name,
        fairness: spec.fairness,
        ...(spec.vendor ? { vendor: spec.vendor } : {}),
        available: this.isAvailable(gameId),
        tables: tables.length,
        players: tables.reduce((a, t) => a + t.players, 0),
        jackpot: tables.reduce((a, t) => a + t.jackpot, 0),
      };
    });
  }

  /** Total jackpot on the platform, for the lobby ticker. */
  totalJackpot(): number {
    return [...this.tables.values()].reduce((a, t) => a + t.jackpot, 0);
  }
}
