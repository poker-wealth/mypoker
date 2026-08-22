import type { ImageSourcePropType } from 'react-native';

/**
 * The game catalogue — artwork, names and categories.
 *
 * Mirrors `frontend/src/lib/games.ts`. Only static presentation lives here. Table counts and
 * jackpots are LIVE values from `/lobby/games`; nothing on the Games screen comes from this file
 * except the picture, the name and which section it sits in.
 *
 * That split is deliberate and was a bug once: the web catalogue used to carry a hardcoded
 * `players` field holding the design document's own numbers (2,541 / 856 / 624 …), and the screen
 * rendered them as live counts. There is no fallback here — when the lobby has not answered, a tile
 * shows a dash.
 *
 * `id` is the LIVE ROOM id. Tapping a tile opens `Table` with it, and those ids
 * (`texas`, `niu-niu`, `red-packet`, …) are exactly the rooms `defaultTables()` mounts in
 * game-server. That is why this route into a felt works where the lobby's does not — the lobby
 * serves catalogue ids like `tx-1` that no room answers to.
 */

export type GameCategory = 'poker' | 'card' | 'quick' | 'arcade';

export interface GameDef {
  id: string;
  name: string;
  category: GameCategory;
  image: ImageSourcePropType;
  /** Shown when the artwork is missing. */
  glyph: string;
}

const CARDS = require('../../assets/brand/cards.png') as ImageSourcePropType;
const BULL = require('../../assets/brand/bull.png') as ImageSourcePropType;
const DDZ = require('../../assets/brand/dou_di_zhu.png') as ImageSourcePropType;
const ENVELOPE = require('../../assets/brand/envelope.png') as ImageSourcePropType;
const SLOTS = require('../../assets/brand/slots.png') as ImageSourcePropType;
const MINES = require('../../assets/brand/minesweepers.png') as ImageSourcePropType;

export const GAMES: GameDef[] = [
  { id: 'texas', name: 'Texas Hold’em', category: 'poker', image: CARDS, glyph: '♠' },
  { id: 'short-deck', name: 'Short Deck', category: 'poker', image: CARDS, glyph: '♦' },
  { id: 'omaha', name: 'Omaha', category: 'poker', image: CARDS, glyph: '♥' },

  { id: 'dou-di-zhu', name: 'Dou Di Zhu', category: 'card', image: DDZ, glyph: '👑' },
  { id: 'niu-niu', name: 'Niu Niu', category: 'card', image: BULL, glyph: '🐮' },
  { id: 'san-zhang', name: 'Zha Jin Hua', category: 'card', image: CARDS, glyph: '🃏' },
  { id: 'baccarat', name: 'Baccarat', category: 'card', image: CARDS, glyph: '🎴' },

  { id: 'red-packet', name: 'Red Packet', category: 'quick', image: MINES, glyph: '🧧' },
  { id: 'slots', name: 'Slot Machines', category: 'arcade', image: SLOTS, glyph: '🎰' },
  { id: 'cowboy-beauty', name: 'Cowboy & Beauty', category: 'quick', image: ENVELOPE, glyph: '🤠' },
  { id: 'lottery', name: 'Lottery', category: 'quick', image: ENVELOPE, glyph: '🎟' },
  { id: 'texas-cowboy', name: 'Texas Cowboy', category: 'quick', image: CARDS, glyph: '🤠' },
];

/**
 * The launch gate. Empty means every game above is live.
 *
 * Kept as its own set, and every screen goes through `visibleGames()` rather than `GAMES`, because
 * the web app shipped a bug where the Games page iterated the raw list — so a withheld game
 * rendered as a tappable tile that opened a real table. An audit found that page to be the single
 * site bypassing the gate. One filter, used everywhere, is what stops that recurring.
 */
export const HIDDEN_GAMES: ReadonlySet<string> = new Set<string>([]);

export const visibleGames = (): GameDef[] => GAMES.filter((g) => !HIDDEN_GAMES.has(g.id));
