/**
 * The game catalog that drives the lobby & games grid. Each entry carries its own
 * visual identity (glyph + gradient) so tiles read as distinct products, not rows.
 * Player counts here are placeholder "live feel" numbers until the lobby socket lands.
 *
 * `name` is the English name and doubles as the search haystack; the displayed
 * name comes from the `gameNames.<id>` translation key. These games have real
 * Chinese names (斗地主, 牛牛, 德州扑克) — transliterations would read as wrong to
 * the audience the mockup is aimed at.
 */
export type GameCategory = 'poker' | 'fast' | 'cards';

export interface GameDef {
  id: string;
  /** English name. Display via t(`gameNames.${id}`); this is the search fallback. */
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
  { id: 'short', name: 'Short Deck', category: 'poker', glyph: '♦', gradient: ['#bb5cf6', '#00d4ff'], players: 412, minBuy: '20' },
  { id: 'redpacket', name: 'Red Packet', category: 'fast', glyph: '🧧', gradient: ['#f85677', '#bb5cf6'], players: 903, minBuy: '1', hot: true },
  { id: 'niuniu', name: 'Niu Niu', category: 'fast', glyph: '🐮', gradient: ['#00d4ff', '#3fd07a'], players: 561, minBuy: '5' },
  { id: 'ddz', name: 'Dou Di Zhu', category: 'cards', glyph: '👑', gradient: ['#6366f1', '#00d4ff'], players: 738, minBuy: '5' },
  { id: 'baccarat', name: 'Baccarat', category: 'cards', glyph: '🎴', gradient: ['#bb5cf6', '#f85677'], players: 327, minBuy: '10' },
];

export const totalPlayers = (): number => GAMES.reduce((sum, g) => sum + g.players, 0);
