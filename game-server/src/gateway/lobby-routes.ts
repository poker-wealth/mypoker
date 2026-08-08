import { Router, type Request, type Response, type NextFunction } from 'express';
import { LobbyService, parseTableFilter } from '../lobby';
import { PLATFORM_CONTEXT, type ViewerContext } from '../lobby/lobby-service';
import type { GatewayConfig } from './config';

/**
 * Lobby reads: what games exist, which tables are running, and how big the
 * jackpots are.
 *
 * The PLATFORM lobby is public — no auth. It is the shop window, and someone
 * deciding whether to sign up needs to see it first.
 *
 * A LEAGUE context is not. Passing `?leagueId=` asks to see a private room, so
 * the caller must be signed in AND a member; anything else falls back to the
 * public lobby rather than erroring, because a failed membership check must not
 * confirm that the league exists.
 *
 * Filter parsing is shared with the serverless lobby function
 * (src/lobby/query.ts) so the two deployments cannot validate differently.
 */
export function buildLobbyRouter(lobby: LobbyService, config?: GatewayConfig): Router {
  const r = Router();

  /**
   * Resolve who is asking and which room they are in.
   *
   * Membership is read from financial-core rather than trusted from the query
   * string or a token claim: memberships change when players join and leave,
   * and a stale claim would keep a private room open to someone who had left.
   */
  const contextFor = async (req: Request): Promise<ViewerContext> => {
    const leagueId = req.query.leagueId;
    if (typeof leagueId !== 'string' || leagueId === '' || !config) return PLATFORM_CONTEXT;

    const auth = req.headers.authorization;
    if (!auth) return PLATFORM_CONTEXT;

    try {
      const upstream = await fetch(`${config.financialCoreUrl}/api/v1/me/leagues`, {
        headers: { authorization: auth },
      });
      if (!upstream.ok) return PLATFORM_CONTEXT;
      const body = (await upstream.json()) as { leagues?: { leagueId: string }[] };
      const memberOf = (body.leagues ?? []).map((l) => l.leagueId);
      // The service checks membership again against this list. Two checks, but
      // the one that matters is the one next to the data.
      return { leagueId, memberOf };
    } catch {
      // Unreachable membership service means we cannot prove membership, and
      // an unprovable claim shows the public lobby.
      return PLATFORM_CONTEXT;
    }
  };

  /**
   * Express 4 catches a synchronous throw and routes it to the error handler,
   * but not a rejected promise — an async handler that throws simply hangs the
   * request until it times out. These handlers became async when league context
   * was added, so the rejection has to be handed back explicitly.
   */
  const handle =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction): void => {
      fn(req, res).catch(next);
    };

  /** The game rail: one row per game type with its pooled jackpot and player count. */
  r.get(
    '/games',
    handle(async (req, res) => {
      const ctx = await contextFor(req);
      res.json({ games: lobby.listGames(ctx), totalJackpot: lobby.totalJackpot(ctx) });
    }),
  );

  /** Running tables, filterable. Powers the Lobby tab's stake and game filters. */
  r.get(
    '/tables',
    handle(async (req, res) => {
      // Parsed before the context lookup so a bad filter still 400s promptly
      // rather than after a round trip that was never going to be used.
      const filter = parseTableFilter(req.query);
      const ctx = await contextFor(req);
      const tables = lobby.listTables(filter, ctx);
      res.json({ tables, count: tables.length });
    }),
  );

  r.get(
    '/tables/:id',
    handle(async (req, res) => {
      const ctx = await contextFor(req);
      const table = lobby.getTable(String(req.params.id), ctx);
      if (!table) {
        res.status(404).json({ error: 'table not found' });
        return;
      }
      res.json(table);
    }),
  );

  return r;
}
