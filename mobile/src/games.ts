/**
 * The game catalog — a copy of `frontend/src/lib/games.ts`.
 *
 * `mobile/` cannot reach across to `frontend/` (no `@/` alias, and the two
 * bundlers don't share a module graph), so the catalogue is duplicated here
 * rather than imported. Everything below — types, `GAMES`, `HIDDEN_GAMES`,
 * `visibleGames()` — is copied VERBATIM from the web source, gate and comments
 * included. Keep the two in step: a change to one catalogue that isn't mirrored
 * in the other is exactly the kind of drift that let a withheld game slip
 * through as a tappable tile once already (see the note on `HIDDEN_GAMES`).
 *
 * The only addition on this side is `ART`/`artFor` below, because React Native
 * cannot resolve a string path like '/brand/cards.png' at runtime — image
 * assets have to be `require`d so the bundler can find them at build time.
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
  | 'slots'
  | 'texas-cowboy';

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
  { id: 'texas-cowboy', name: 'Texas Cowboy', category: 'quick', image: '/brand/cards.png', glyph: '🤠', gradient: ['#f59e0b', '#dc2626'], minBuy: '1', hot: true },
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
/**
 * Games withheld from the lobby.
 *
 * Empty now: baccarat and cowboy-beauty were held back "until their table screens are ready", and
 * those screens are finished and verified end-to-end — each sits, bets, settles through the ledger
 * and pays the right rake. Putting a game in here is a launch decision, so taking one out is too.
 */
/**
 * Games withheld from the lobby.
 *
 * Empty again. Seven games came off sale earlier in this branch over the predictable jackpot seed
 * and go back now that every room draws on the seed its round was actually generated from.
 * `jackpot-seed.test.ts` fails if any room reintroduces the old pattern.
 *
 * Putting a game in here is a launch decision, so taking one out is too.
 */
export const HIDDEN_GAMES: ReadonlySet<string> = new Set<GameId>([]);

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

/**
 * RN resolves assets at build time, so every image is a static require — a
 * string path like `game.image` ('/brand/cards.png') cannot be handed to
 * `<Image source={{ uri }}>` because there is no server serving it. The keys
 * here are exactly the `image` values above, so `GAMES` stays diffable against
 * the web catalogue while this file supplies the one thing RN needs that the
 * web doesn't.
 */
const ART: Record<string, number> = {
  '/brand/bull.png': require('../assets/brand/bull.png'),
  '/brand/cards.png': require('../assets/brand/cards.png'),
  // dou_di_zhu is actually a JPEG despite the web catalogue naming it .png (copied
  // from frontend/public/brand/ where browsers sniff content and don't care about
  // the extension). The key mirrors the web catalogue's `image` path; the require
  // points at what the file actually is. Naming it .png broke an Android build:
  // AAPT compiles resources for real and rejected the mislabelled file.
  '/brand/dou_di_zhu.png': require('../assets/brand/dou_di_zhu.jpg'),
  '/brand/envelope.png': require('../assets/brand/envelope.png'),
  '/brand/minesweepers.png': require('../assets/brand/minesweepers.png'),
  '/brand/slots.png': require('../assets/brand/slots.png'),
};

export const artFor = (image?: string) => (image ? ART[image] : undefined);
