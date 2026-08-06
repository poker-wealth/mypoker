/**
 * The game catalog.
 *
 * Ids are the **server's** GameId values (game-server/src/lobby/game-catalog.ts)
 * — not a parallel client vocabulary. They previously diverged ('niuniu' here vs
 * 'niu-niu' there), which meant server lobby rows could not be matched to their
 * tile without a translation table nobody would remember to update.
 *
 * What lives here is the *visual* identity — glyph, gradient, category — which
 * is a client concern the server has no opinion about. Live figures (tables,
 * players, jackpot, availability) come from GET /lobby/games; the counts below
 * are the offline fallback for when it can't be reached.
 *
 * Display names come from the `gameNames.<id>` translation keys, not `name`.
 */

/** Matches the filter chips in the approved design: ALL · POKER · CARD · ARCADE · QUICK. */
export type GameCategory = 'poker' | 'card' | 'arcade' | 'quick';

export const CATEGORIES: GameCategory[] = ['poker', 'card', 'arcade', 'quick'];

export type GameId =
  | 'texas'
  | 'short-deck'
  | 'omaha'
  | 'baccarat'
  | 'niu-niu'
  | 'dou-di-zhu'
  | 'san-zhang'
  | 'red-packet'
  | 'cowboy-beauty'
  | 'lottery'
  | 'slots';

/**
 * Games in the catalog that aren't on sale yet.
 *
 * These exist and are coming — docs/P3-feature-queue.md lists both among the games
 * to build once the P3 list is done, and Baccarat has its own milestone in the
 * 12-week plan (player/banker/tie, third-card rule) plus a VIP effective-volume
 * coefficient of ×0.3. They're withheld only because a tile for a game nobody can
 * play yet is worse than no tile (Victor, Aug 6).
 *
 * So this is a launch gate, not a deletion. When an engine ships, remove its id
 * here and the tile appears with its name, art and translations already in place.
 */
export const HIDDEN_GAMES: ReadonlySet<string> = new Set<GameId>(['baccarat', 'cowboy-beauty']);

/** The catalog minus anything not yet on sale. Use this for anything player-facing. */
export const visibleGames = (): GameDef[] => GAMES.filter((g) => !HIDDEN_GAMES.has(g.id));

export interface GameDef {
  id: GameId;
  /** English name — the search fallback. Display via t(`gameNames.${id}`). */
  name: string;
  category: GameCategory;
  glyph: string;
  /** two-stop gradient [from, to] used for the tile wash */
  gradient: [string, string];
  /** Offline fallback figures, used only when /lobby/games is unreachable. */
  tables: number;
  players: number;
  jackpot: number;
  minBuy: string;
  hot?: boolean;
}

export const GAMES: GameDef[] = [
  // ── POKER ──────────────────────────────────────────────────────────────────
  { id: 'texas', name: 'Texas Hold’em', category: 'poker', glyph: '♠', gradient: ['#6366f1', '#bb5cf6'], tables: 2541, players: 1284, jackpot: 125421.32, minBuy: '10', hot: true },
  { id: 'short-deck', name: 'Short Deck', category: 'poker', glyph: '♦', gradient: ['#bb5cf6', '#00d4ff'], tables: 856, players: 412, jackpot: 48521.1, minBuy: '20' },
  { id: 'omaha', name: 'Omaha', category: 'poker', glyph: '♥', gradient: ['#f85677', '#bb5cf6'], tables: 624, players: 268, jackpot: 75322.65, minBuy: '20' },

  // ── CARD ───────────────────────────────────────────────────────────────────
  { id: 'dou-di-zhu', name: 'Dou Di Zhu', category: 'card', glyph: '👑', gradient: ['#6366f1', '#00d4ff'], tables: 1673, players: 738, jackpot: 88220.21, minBuy: '5' },
  { id: 'niu-niu', name: 'Niu Niu', category: 'card', glyph: '🐮', gradient: ['#00d4ff', '#3fd07a'], tables: 1234, players: 561, jackpot: 8421.66, minBuy: '5' },
  // 'san-zhang' (三张) is the same game the design labels Zha Jin Hua (炸金花).
  // Keeping the server's id and translating the label per locale.
  { id: 'san-zhang', name: 'Zha Jin Hua', category: 'card', glyph: '🃏', gradient: ['#3fd07a', '#00d4ff'], tables: 1002, players: 194, jackpot: 9221.1, minBuy: '5' },
  { id: 'baccarat', name: 'Baccarat', category: 'card', glyph: '🎴', gradient: ['#bb5cf6', '#f85677'], tables: 918, players: 327, jackpot: 41902.55, minBuy: '10' },

  // ── QUICK ──────────────────────────────────────────────────────────────────
  { id: 'red-packet', name: 'Red Packet', category: 'quick', glyph: '🧧', gradient: ['#f85677', '#bb5cf6'], tables: 1673, players: 903, jackpot: 12043.5, minBuy: '1', hot: true },
  { id: 'slots', name: 'Slot Machines', category: 'quick', glyph: '🎰', gradient: ['#bb5cf6', '#3fd07a'], tables: 2145, players: 205, jackpot: 31288.4, minBuy: '0.5' },
  { id: 'lottery', name: 'Lottery', category: 'quick', glyph: '🎟', gradient: ['#00d4ff', '#6366f1'], tables: 1120, players: 1120, jackpot: 5210.75, minBuy: '0.2' },
  { id: 'cowboy-beauty', name: 'Cowboy & Beauty', category: 'quick', glyph: '🤠', gradient: ['#f85677', '#6366f1'], tables: 764, players: 486, jackpot: 7318.9, minBuy: '1' },
];

const BY_ID = new Map(GAMES.map((g) => [g.id, g]));

/** Visual identity for a server-supplied game id, if we surface that game. */
export function gameVisual(id: string): GameDef | undefined {
  return BY_ID.get(id as GameId);
}

export const gamesIn = (category: GameCategory): GameDef[] =>
  visibleGames().filter((g) => g.category === category);

/** Lobby headline figure — counts only games a player can actually join. */
export const totalPlayers = (): number =>
  visibleGames().reduce((sum, g) => sum + g.players, 0);
