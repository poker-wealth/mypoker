import { Router, type Request, type Response } from 'express';
import { LobbyService, parseTableFilter } from '../lobby';

/**
 * Lobby reads: what games exist, which tables are running, and how big the
 * jackpots are.
 *
 * Public — no auth. This is the shop window, and a player deciding whether to
 * sign up needs to see it first. Nothing here is player-specific, so there is
 * nothing to leak.
 *
 * Filter parsing is shared with the serverless lobby function
 * (src/lobby/query.ts) so the two deployments cannot validate differently.
 */
export function buildLobbyRouter(lobby: LobbyService): Router {
  const r = Router();

  /** The game rail: one row per game type with its pooled jackpot and player count. */
  r.get('/games', (_req: Request, res: Response) => {
    res.json({ games: lobby.listGames(), totalJackpot: lobby.totalJackpot() });
  });

  /** Running tables, filterable. Powers the Lobby tab's stake and game filters. */
  r.get('/tables', (req: Request, res: Response) => {
    const tables = lobby.listTables(parseTableFilter(req.query));
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
