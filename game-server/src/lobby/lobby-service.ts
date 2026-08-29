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
  /**
   * The table's OWN name, when it has one distinct from its game.
   *
   * Rows used to be labelled purely by game, so the two Hold'em tables both
   * read "Texas Hold'em" and were indistinguishable — and the sit refusal,
   * which names the table from the room, pointed at a string ("Hold'em ·
   * $0.50/1") that appeared nowhere in the lobby. One name, from the room,
   * fixes both. Optional: tables created by a league or a player have no name
   * of their own and keep falling back to the game's.
   */
  name?: string;
  /**
   * Table stake level — the big blind for poker, a fixed base stake for a game
   * that has one, or NULL for a game with neither.
   *
   * Nullable because nine of the thirteen live tables genuinely have no stake
   * level: each player picks their own bet per round. They used to report 0,
   * and the lobby printed "Blinds 0/0" for every one of them.
   */
  stakes: number | null;
  /**
   * The small blind, when there is one. Sent rather than derived.
   *
   * Both clients used to render `stakes / 2`, which is right only while every
   * table is half-and-half. The server knows the real figure, so it says it.
   */
  smallBlind?: number | null;
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
  buyInBB: number | null;
  /**
   * Which system this table belongs to (§2, §3.10).
   *
   * PLATFORM tables are the public lobby. LEAGUE tables are private rooms:
   * "Only visible to league members. Lobby players CANNOT see it." (spec line
   * 46) — and their rake goes 100% to LEAGUE_INVENTORY rather than the platform
   * Treasury.
   *
   * Defaulted at the boundary rather than left optional, so a table created
   * without thinking about it is a platform table and cannot accidentally
   * inherit a league's isolation.
   */
  tableType?: TableType;
  /** Required when tableType is LEAGUE; meaningless otherwise. */
  leagueId?: string;
}

export type TableType = 'PLATFORM' | 'LEAGUE';

/**
 * Who is asking, for visibility purposes.
 *
 * `null` is the public lobby — a signed-out browser, or a player in platform
 * context. A league context carries the id of the league whose room the viewer
 * is inside.
 */
export interface ViewerContext {
  leagueId: string | null;
  /** Every league this viewer belongs to. A viewer only ever sees their own. */
  memberOf: readonly string[];
}

export const PLATFORM_CONTEXT: ViewerContext = { leagueId: null, memberOf: [] };

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
  updateTable(
    tableId: string,
    patch: Partial<Pick<LobbyTable, 'players' | 'jackpot' | 'stakes' | 'smallBlind' | 'name'>>,
  ): void {
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
      // The table's own name wins; the game's is the fallback for rows that
      // have none. Same string the refusal message uses, deliberately.
      name: t.name ?? spec.name,
      status,
      minPlayers: spec.minPlayers,
      maxPlayers: spec.maxPlayers,
      fairness: spec.fairness,
      ...(spec.vendor ? { vendor: spec.vendor } : {}),
      seatsFree: Math.max(0, spec.maxPlayers - t.players),
      ...(status === 'WAITING' ? { waitingFor: spec.minPlayers - t.players } : {}),
    };
  }

  /**
   * Platform / League isolation, applied at the only place tables are read.
   *
   * Both directions, per the acceptance criterion: the public lobby never shows
   * a league's private room, and a league context never shows platform tables.
   * A player inside their alliance is looking at their alliance.
   *
   * Membership is checked as well as context — carrying a leagueId is not the
   * same as belonging to it, and a fabricated context must not open the room.
   *
   * The default is PLATFORM_CONTEXT, so a call site that forgets to pass one
   * shows public tables only. That is the direction a mistake should fail in:
   * a missing argument hides private rooms rather than exposing them.
   */
  private visibleTo(t: LobbyTable, ctx: ViewerContext): boolean {
    const isLeagueTable = t.tableType === 'LEAGUE';

    if (ctx.leagueId === null) return !isLeagueTable;
    if (!ctx.memberOf.includes(ctx.leagueId)) return false;
    return isLeagueTable && t.leagueId === ctx.leagueId;
  }

  getTable(tableId: string, ctx: ViewerContext = PLATFORM_CONTEXT): TableView | undefined {
    const t = this.tables.get(tableId);
    // Undefined rather than a permission error: a room you cannot see should not
    // be distinguishable from a room that does not exist, or the lobby becomes
    // an oracle for which leagues are running which tables.
    if (!t || !this.visibleTo(t, ctx)) return undefined;
    return this.viewOf(t);
  }

  /**
   * A table may only start when its game is up and it has met its minimum.
   * Below minimum it shows "Waiting for players" and does NOT auto-start.
   */
  canStart(tableId: string): boolean {
    const t = this.tables.get(tableId);
    return t ? this.statusOf(t) === 'OPEN' || this.statusOf(t) === 'FULL' : false;
  }

  listTables(filter: TableFilter = {}, ctx: ViewerContext = PLATFORM_CONTEXT): TableView[] {
    return [...this.tables.values()]
      .filter((t) => this.visibleTo(t, ctx))
      .map((t) => this.viewOf(t))
      .filter((v) => {
        if (filter.gameId && v.gameId !== filter.gameId) return false;
        // A table with no stake level cannot satisfy a stake filter. Excluded
        // rather than treated as zero, which would have made every stakeless
        // table match `maxStakes` and none match `minStakes` — a silent,
        // asymmetric wrong answer.
        if (filter.minStakes !== undefined && (v.stakes === null || v.stakes < filter.minStakes)) return false;
        if (filter.maxStakes !== undefined && (v.stakes === null || v.stakes > filter.maxStakes)) return false;
        if (filter.hasSeats && v.seatsFree === 0) return false;
        if (filter.minJackpot !== undefined && v.jackpot < filter.minJackpot) return false;
        if (filter.readyOnly && v.status !== 'OPEN' && v.status !== 'FULL') return false;
        if (filter.fairness && v.fairness !== filter.fairness) return false;
        return true;
      })
      .sort((a, b) => b.jackpot - a.jackpot || b.players - a.players || a.id.localeCompare(b.id));
  }

  /**
   * The lobby's game rail: one row per game type, with its pooled jackpot.
   *
   * Context-scoped like everything else. An unscoped count would leak a
   * league's activity into the public rail — table counts, seated players and
   * jackpot totals are exactly the figures a private room is private about,
   * and an aggregate is no less a disclosure for being a sum.
   */
  listGames(ctx: ViewerContext = PLATFORM_CONTEXT): GameSummary[] {
    const visible = [...this.tables.values()].filter((t) => this.visibleTo(t, ctx));
    return GAME_IDS.map((gameId) => {
      const spec = gameSpec(gameId);
      const tables = visible.filter((t) => t.gameId === gameId);
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

  /** Total jackpot in the caller's context, for the ticker. */
  totalJackpot(ctx: ViewerContext = PLATFORM_CONTEXT): number {
    return [...this.tables.values()]
      .filter((t) => this.visibleTo(t, ctx))
      .reduce((a, t) => a + t.jackpot, 0);
  }
}
