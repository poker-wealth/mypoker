import type { LobbyService } from './lobby-service';
import type { GameId } from './game-catalog';
import type { TableSummary } from '../live/room-state';

/**
 * Make the lobby describe the tables that actually exist.
 *
 * THE BUG THIS FIXES
 *
 * The gateway served its lobby from `dev-seed.ts` — ids like `tx-1`, `nn-1` — while the live rooms
 * were mounted from `defaultTables()` with ids like `texas`, `niu-niu`. Two lists, no relationship.
 * Every row a player could see named a table the hub had never heard of, so tapping any of them
 * returned `unknown table: tx-1`. Both clients hit it: the Mini App navigates to `/table/{id}` with
 * exactly those ids.
 *
 * `dev-seed.ts` says of itself that it is a PLACEHOLDER and that "in production the LobbyService
 * must be the instance the game loop owns and mutates as tables fill, empty and accrue jackpot".
 * `gateway/server.ts` called it unconditionally, with no dev guard — so that placeholder WAS the
 * production lobby, advertising invented tables at invented stakes that nobody could join.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not invent anything. Everything below is read from the room's own summary. Where the
 * room does not report a figure — a pooled jackpot, for instance — the lobby gets 0, which the
 * clients already render as "OPEN" rather than as a prize. That is the whole point: the lobby is
 * now allowed to look empty, because it is.
 *
 * Expect the visible numbers to fall. The placeholder advertised a $3,265 grand jackpot and five
 * Texas tables; the truth is one Texas table and pools that start at nothing. A smaller honest
 * lobby beats a large fictional one.
 */

/** The `id → game` mapping, which `TableSummary` does not carry but the configs do. */
export interface LiveTableIdentity {
  id: string;
  game: GameId;
}

/**
 * Replace the lobby's contents with the hub's rooms.
 *
 * Removals matter as much as additions: a table that closed must leave the lobby, or players keep
 * being sent to a room that is gone — the same failure in the other direction.
 */
export function syncLobbyWithLiveTables(
  lobby: LobbyService,
  summaries: TableSummary[],
  identities: readonly LiveTableIdentity[],
): void {
  const gameOf = new Map(identities.map((t) => [t.id, t.game]));
  const live = new Set<string>();

  for (const s of summaries) {
    const gameId = gameOf.get(s.tableId);
    // A room with no matching config is one we cannot describe honestly — skip it rather than
    // guess its game.
    if (!gameId) continue;

    live.add(s.tableId);

    // The stake level: the big blind for poker, a fixed base stake for a game that has one
    // (only Dou Di Zhu today), and NULL for the rest.
    //
    // The comment that used to sit here said the non-poker rooms "carry their base bet in the
    // same field, which is why the lobby's stakes column is meaningful across all of them".
    // That was false — every one of them hardcoded `bigBlind: 0` — and because it read as an
    // explanation, nobody checked it. Nine of thirteen tables advertised "Blinds 0/0".
    const stakes = s.bigBlind ?? s.baseStake ?? null;
    // Buy-in depth in big blinds. Null, not 0, when there is no stake to divide by: "0 BB" is a
    // claim about depth, and an unmeasurable depth is not a shallow one.
    const buyInBB = stakes !== null && stakes > 0 ? Math.round(s.minBuyIn / stakes) : null;
    const smallBlind = s.smallBlind ?? null;

    const existing = lobby.getTable(s.tableId);
    if (existing) {
      lobby.updateTable(s.tableId, { players: s.seated, stakes, smallBlind });
      continue;
    }

    lobby.addTable({
      id: s.tableId,
      gameId,
      stakes,
      smallBlind,
      players: s.seated,
      // The room does not report a pooled jackpot in its summary. 0 means "nothing to advertise",
      // and every client already prints OPEN instead of a figure for it. Inventing one here is
      // exactly the habit this change exists to end.
      jackpot: 0,
      buyInBB,
    });
  }

  for (const t of lobby.listTables()) {
    if (!live.has(t.id)) lobby.removeTable(t.id);
  }
}
