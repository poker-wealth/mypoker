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

/** Open a table. v1 is Hold'em only; the `game` field leaves room to widen. */
export const createPlayerTableApi = (body: {
  game?: 'texas';
  visibility: TableVisibility;
}): Promise<CreatedTable> => api.post<CreatedTable>('/tables', body);
