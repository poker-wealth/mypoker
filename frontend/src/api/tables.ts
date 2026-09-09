import { api } from './client';

/**
 * Player-created tables (owner-approved; NOT in the FairPlay doc).
 *
 * Any player can open a Hold'em table and choose whether it's PUBLIC (also
 * listed in the lobby, anyone can join) or PRIVATE (reachable only by the link
 * they share — "play with friends"). The gateway mints the id as `t-<hex>`,
 * which `isOpenableTableId` whitelists so `/table/<id>` opens it.
 *
 * Distinct from league rooms (`/leagues/:id/tables`), which are league-scoped
 * and membership-checked. This one asks nothing of the player but a session.
 */

export type TableVisibility = 'public' | 'private';

export interface CreatedTable {
  tableId: string;
  visibility: TableVisibility;
}

/** The poker variants — the games with the full create-options screen. */
export type PlayerPokerGame = 'texas' | 'short-deck' | 'omaha';

/**
 * Every game a player may open a table for. Poker variants take the full
 * options screen; the rest open as a fresh copy of that game's house table
 * (the server ignores the poker-only fields for them).
 */
export type PlayerTableGame =
  | PlayerPokerGame
  | 'baccarat'
  | 'niu-niu'
  | 'san-zhang'
  | 'red-packet'
  | 'cowboy-beauty'
  | 'dou-di-zhu'
  | 'lottery'
  | 'slots'
  | 'texas-cowboy';

/** Open a table, with the settings the creator chose. */
export const createPlayerTableApi = (body: {
  game?: PlayerTableGame;
  visibility: TableVisibility;
  /**
   * Chairs at the table — not players required. Two ready players deal a hand
   * whatever this is; the remaining chairs wait for someone to take one.
   *
   * The ceiling is per game and belongs to the felt, not to the rules: a design
   * places seats up to a point and no further. The server refuses anything
   * above it rather than producing a table the felt cannot draw.
   */
  seats?: number;
  /** Chips, not currency — 1 chip = $0.01. The small blind must be the smaller. */
  smallBlind?: number;
  bigBlind?: number;
  /**
   * Minimum buy-in in BIG BLINDS, so it means the same thing at every stake.
   * The server derives the chip figures and allows up to 10x for the maximum.
   */
  buyInBB?: number;
  /** Maximum buy-in in big blinds. Absent keeps the server's 10x spread. */
  buyInMaxBB?: number;

  // ── Game options (the create-a-game screen) — all default to off/normal. ──
  /** Forced ante, chips, dead into the pot before the blinds. */
  ante?: number;
  /** UTG posts a live 2×BB straddle each hand. */
  straddle?: boolean;
  /** Every action is the whole stack or the muck. Refused for pot-limit games. */
  allInOrFold?: boolean;
  /** Your own cards stay face-down preflop until it is your turn to act. */
  hideHoleCards?: boolean;
  /** false → "restricting onlookers": only seated players receive the table. */
  spectatorsAllowed?: boolean;
  /** false → this table never offers insurance. */
  insuranceEnabled?: boolean;
  /** Refuse a seat when a seated player shares the connection's IP. */
  banSameIp?: boolean;
  /** Refuse a seat when a seated player shares the reported GPS point. */
  banSameGps?: boolean;
  /** Seated players required before the first hand deals (2..seats). */
  autoStartPlayers?: number;
}): Promise<CreatedTable> => api.post<CreatedTable>('/tables', body);
