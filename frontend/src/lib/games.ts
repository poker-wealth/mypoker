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
 * jackpot, availability) come from GET /lobby/games; the counts below are the
 * offline fallback for when it can't be reached.
 *
 * Display names come from the `gameNames.<id>` translation keys, not `name`.
 */
export type GameCategory = 'poker' | 'fast' | 'cards';

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
  glyph: string;
  /** two-stop gradient [from, to] used for the tile wash */
  gradient: [string, string];
  players: number;
  minBuy: string;
  hot?: boolean;
}

export const GAMES: GameDef[] = [
  { id: 'texas', name: 'Texas Hold’em', category: 'poker', glyph: '♠', gradient: ['#6366f1', '#bb5cf6'], players: 1284, minBuy: '10', hot: true },
  { id: 'short-deck', name: 'Short Deck', category: 'poker', glyph: '♦', gradient: ['#bb5cf6', '#00d4ff'], players: 412, minBuy: '20' },
  { id: 'omaha', name: 'Omaha', category: 'poker', glyph: '♥', gradient: ['#f85677', '#bb5cf6'], players: 268, minBuy: '20' },
  { id: 'red-packet', name: 'Red Packet', category: 'fast', glyph: '🧧', gradient: ['#f85677', '#bb5cf6'], players: 903, minBuy: '1', hot: true },
  { id: 'niu-niu', name: 'Niu Niu', category: 'fast', glyph: '🐮', gradient: ['#00d4ff', '#3fd07a'], players: 561, minBuy: '5' },
  { id: 'dou-di-zhu', name: 'Dou Di Zhu', category: 'cards', glyph: '👑', gradient: ['#6366f1', '#00d4ff'], players: 738, minBuy: '5' },
  { id: 'baccarat', name: 'Baccarat', category: 'cards', glyph: '🎴', gradient: ['#bb5cf6', '#f85677'], players: 327, minBuy: '10' },
  { id: 'san-zhang', name: 'San Zhang', category: 'cards', glyph: '🃏', gradient: ['#3fd07a', '#00d4ff'], players: 194, minBuy: '5' },
  { id: 'cowboy-beauty', name: 'Cowboy & Beauty', category: 'fast', glyph: '🤠', gradient: ['#f85677', '#6366f1'], players: 486, minBuy: '1' },
  { id: 'lottery', name: 'Lottery', category: 'fast', glyph: '🎟', gradient: ['#00d4ff', '#6366f1'], players: 1120, minBuy: '0.2' },
  { id: 'slots', name: 'Slots', category: 'fast', glyph: '🎰', gradient: ['#bb5cf6', '#3fd07a'], players: 205, minBuy: '0.5' },
];

const BY_ID = new Map(GAMES.map((g) => [g.id, g]));

/** Visual identity for a server-supplied game id, if we have one. */
export function gameVisual(id: string): GameDef | undefined {
  return BY_ID.get(id as GameId);
}

export const totalPlayers = (): number => GAMES.reduce((sum, g) => sum + g.players, 0);
