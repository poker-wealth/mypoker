/**
 * The game catalog.
 *
 * Ids are the **server's** GameId values (game-server/src/lobby/game-catalog.ts)
 * — not a parallel client vocabulary. They previously diverged ('niuniu' here vs
 * 'niu-niu' there), which meant server lobby rows could not be matched to their
 * tile without a translation table nobody would remember to update.
 *
 * What lives here is the *visual* identity — glyph, gradient, category — which
 * is a client concern the server has no opinion about. Live figures (players,
 * jackpot, availability) come from GET /lobby/games; when it can't be reached
 * the tiles show an em dash, never an invented count. (Hardcoded fallback
 * counts used to live here; they were deleted with the mock data.)
 *
 * Display names come from the `gameNames.<id>` translation keys, not `name`.
 */
export type GameCategory = 'poker' | 'card' | 'arcade' | 'quick';

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

export interface GameDef {
  id: GameId;
  /** English name — the search fallback. Display via t(`gameNames.${id}`). */
  name: string;
  category: GameCategory;
  image?: string;
  glyph: string;
  /** two-stop gradient [from, to] used for the tile wash */
  gradient: [string, string];
  minBuy: string;
  hot?: boolean;
}

export const GAMES: GameDef[] = [
  { id: 'texas', name: 'Texas Hold’em', category: 'poker', image: '/brand/cards.png', glyph: '♠', gradient: ['#6366f1', '#bb5cf6'], minBuy: '10', hot: true },
  { id: 'short-deck', name: 'Short Deck', category: 'poker', image: '/brand/cards.png', glyph: '♦', gradient: ['#bb5cf6', '#00d4ff'], minBuy: '20' },
  { id: 'omaha', name: 'Omaha', category: 'poker', image: '/brand/cards.png', glyph: '♥', gradient: ['#f85677', '#bb5cf6'], minBuy: '20' },
  
  { id: 'dou-di-zhu', name: 'Dou Di Zhu', category: 'card', image: '/brand/dou_di_zhu.png', glyph: '👑', gradient: ['#6366f1', '#00d4ff'], minBuy: '5' },
  { id: 'niu-niu', name: 'Niu Niu', category: 'card', image: '/brand/bull.png', glyph: '🐮', gradient: ['#00d4ff', '#3fd07a'], minBuy: '5' },
  { id: 'san-zhang', name: 'Zha Jin Hua', category: 'card', image: '/brand/cards.png', glyph: '🃏', gradient: ['#3fd07a', '#00d4ff'], minBuy: '5' },
  { id: 'baccarat', name: 'Baccarat', category: 'card', image: '/brand/cards.png', glyph: '🎴', gradient: ['#bb5cf6', '#f85677'], minBuy: '10' },
  
  { id: 'red-packet', name: 'Red Packet', category: 'quick', image: '/brand/minesweepers.png', glyph: '🧧', gradient: ['#f85677', '#bb5cf6'], minBuy: '1', hot: true },
  { id: 'slots', name: 'Slot Machines', category: 'arcade', image: '/brand/slots.png', glyph: '🎰', gradient: ['#bb5cf6', '#3fd07a'], minBuy: '0.5' },
  { id: 'cowboy-beauty', name: 'Cowboy & Beauty', category: 'quick', image: '/brand/envelope.png', glyph: '🤠', gradient: ['#f85677', '#6366f1'], minBuy: '1' },
  { id: 'lottery', name: 'Lottery', category: 'quick', image: '/brand/envelope.png', glyph: '🎟', gradient: ['#00d4ff', '#6366f1'], minBuy: '0.2' },
];

/**
 * Games in the catalog that are not on sale yet — withheld on Victor's
 * instruction (Aug 6) until their table screens are ready: a tile for a game
 * nobody can play is worse than no tile.
 *
 * The mockup's separate "Minesweeper" and "Slot Jihe" tiles were confirmed by
 * Victor (Aug 8) to BE red-packet ("Red Packet Minesweeper") and slots ("Slot
 * Machines") — one game each, not four. The phantom ids are gone rather than
 * hidden: a hidden id implies something real is waiting behind it.
 *
 * A launch gate, not a deletion: entries keep art and translations, so
 * releasing one is deleting an id from this set.
 */
export const HIDDEN_GAMES: ReadonlySet<string> = new Set<GameId>([
  'baccarat',
  'cowboy-beauty',
]);

/** The catalog minus anything not yet on sale. Use for anything player-facing. */
export const visibleGames = (): GameDef[] => GAMES.filter((g) => !HIDDEN_GAMES.has(g.id));

export const gamesIn = (category: GameCategory): GameDef[] =>
  visibleGames().filter((g) => g.category === category);

export const CATEGORIES: GameCategory[] = ['poker', 'card', 'arcade', 'quick'];

const BY_ID = new Map(GAMES.map((g) => [g.id, g]));

/** Visual identity for a server-supplied game id, if we have one. */
export function gameVisual(id: string): GameDef | undefined {
  return BY_ID.get(id as GameId);
}

