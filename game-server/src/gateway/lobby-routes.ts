import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { LobbyService, GAME_IDS, type GameId, type TableFilter } from '../lobby';

/**
 * Lobby reads: what games exist, which tables are running, and how big the
 * jackpots are.
 *
 * Public — no auth. This is the shop window, and a player deciding whether to
 * sign up needs to see it first. Nothing here is player-specific, so there is
 * nothing to leak.
 *
 * Backed by the LobbyService the tests already cover, so the numbers are the
 * server's, not a second set invented for the API.
 */

const filterQuery = z.object({
  gameId: z.enum(GAME_IDS as unknown as [GameId, ...GameId[]]).optional(),
  minStakes: z.coerce.number().nonnegative().optional(),
  maxStakes: z.coerce.number().nonnegative().optional(),
  hasSeats: z.enum(['true', 'false']).optional(),
  minJackpot: z.coerce.number().nonnegative().optional(),
  readyOnly: z.enum(['true', 'false']).optional(),
  fairness: z.enum(['PROVABLE', 'VENDOR_ATTESTED']).optional(),
});

export function buildLobbyRouter(lobby: LobbyService): Router {
  const r = Router();

  /** The game rail: one row per game type with its pooled jackpot and player count. */
  r.get('/games', (_req: Request, res: Response) => {
    res.json({ games: lobby.listGames(), totalJackpot: lobby.totalJackpot() });
  });

  /** Running tables, filterable. Powers the Lobby tab's stake and game filters. */
  r.get('/tables', (req: Request, res: Response) => {
    const q = filterQuery.parse(req.query);

    const filter: TableFilter = {
      ...(q.gameId !== undefined ? { gameId: q.gameId } : {}),
      ...(q.minStakes !== undefined ? { minStakes: q.minStakes } : {}),
      ...(q.maxStakes !== undefined ? { maxStakes: q.maxStakes } : {}),
      ...(q.hasSeats !== undefined ? { hasSeats: q.hasSeats === 'true' } : {}),
      ...(q.minJackpot !== undefined ? { minJackpot: q.minJackpot } : {}),
      ...(q.readyOnly !== undefined ? { readyOnly: q.readyOnly === 'true' } : {}),
      ...(q.fairness !== undefined ? { fairness: q.fairness } : {}),
    };

    const tables = lobby.listTables(filter);
    res.json({ tables, count: tables.length });
  });

  r.get('/tables/:id', (req: Request, res: Response) => {
    const table = lobby.getTable(String(req.params.id));
    if (!table) {
      res.status(404).json({ error: 'table not found' });
      return;
    }
    res.json(table);
  });

  return r;
}
