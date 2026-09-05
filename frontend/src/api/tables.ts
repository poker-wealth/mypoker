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
  /**
   * The six-digit invite code, for a private table. `null` for a public one —
   * there is nothing to prove when anyone may sit.
   *
   * This is a credential. It is put in the share link so a forwarded link keeps
   * working (before this existed the link WAS the only secret, so dropping it
   * from the link would have broken every existing share), and shown separately
   * so it can be read aloud. Both references do the same: HHPoker prints it on
   * the felt beside the table id — docs/REFERENCE-STUDY-HH.md §14.2.
   */
  joinCode: string | null;
}

/** Open a table. v1 is Hold'em only; the `game` field leaves room to widen. */
export const createPlayerTableApi = (body: {
  game?: 'texas';
  visibility: TableVisibility;
  /**
   * Chairs at the table, 2–6 — not players required. Two ready players deal a
   * hand whatever this is; the remaining chairs wait for someone to take one.
   * The server clamps it, so an out-of-range value is refused rather than
   * silently producing a table the felt cannot draw.
   */
  seats?: number;
}): Promise<CreatedTable> => api.post<CreatedTable>('/tables', body);

/**
 * Prove you hold a private table's code.
 *
 * Called before connecting to a table reached by a link that carries `?code=`,
 * and by the code prompt when it does not. Success is remembered server-side
 * for this player, so it is asked once rather than on every reconnect.
 *
 * A wrong code and a table that does not exist both come back 403 on purpose —
 * distinguishing them would turn this into an oracle for which table ids exist.
 */
export const unlockTableApi = (tableId: string, code: string): Promise<{ unlocked: boolean }> =>
  api.post<{ unlocked: boolean }>(`/tables/${encodeURIComponent(tableId)}/unlock`, { code });
