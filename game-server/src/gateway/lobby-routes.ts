import { Router, type Request, type Response, type NextFunction } from 'express';
import { LobbyService, parseTableFilter } from '../lobby';
import { PLATFORM_CONTEXT, type ViewerContext } from '../lobby/lobby-service';
import type { GatewayConfig } from './config';
import { verifyToken } from './tokens';
import type { TableHub } from '../live/table-hub';

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

  /**
   * The table this caller is seated at, or null. Best-effort and OPTIONAL.
   *
   * The platform lobby is public and must stay public — it is the shop window
   * (see above). So this reads the token only if one happens to be there, and
   * any failure means "no marker", never an error: a signed-out visitor must
   * get the same lobby they always did.
   *
   * Why the lobby needs to know at all: the server enforces one account, one
   * table (§8.1), so a player who sits down and navigates away is refused at
   * every other table until they stand. That rule is right, but nothing
   * anywhere told them WHICH table held their seat, and with thirteen of them
   * the only recovery was to open each in turn. The rule was never the dead
   * end; the missing signpost was.
   *
   * Read live from the hub rather than stored on the lobby row, because a seat
   * is per-viewer state and the lobby's rows are shared by everyone.
   */
  const seatedTableFor = (req: Request): string | null => {
    if (!config) return null;
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;

    const hub = req.app.locals.tableHub as TableHub | undefined;
    // Read off app.locals rather than taken as a constructor argument: the hub
    // is built by mountLiveTables AFTER this router is mounted, so at
    // construction time there is nothing to inject.
    if (!hub) return null;

    try {
      const claims = verifyToken(header.slice('Bearer '.length), config.jwtSecret);
      return hub.seatedAt(claims.playerId)?.tableId ?? null;
    } catch {
      // An expired or forged token is simply an anonymous viewer here.
      return null;
    }
  };

  /** Running tables, filterable. Powers the Lobby tab's stake and game filters. */
  r.get(
    '/tables',
    handle(async (req, res) => {
      // Parsed before the context lookup so a bad filter still 400s promptly
      // rather than after a round trip that was never going to be used.
      const filter = parseTableFilter(req.query);
      const ctx = await contextFor(req);
      const tables = lobby.listTables(filter, ctx);
      const seatedAt = seatedTableFor(req);
      res.json({
        tables: tables.map((t) => (t.id === seatedAt ? { ...t, youAreSeated: true } : t)),
        count: tables.length,
        // Also sent at the top level so a client can say "you are seated at X"
        // even when that table is filtered out of the list the player is
        // looking at — which is exactly when they are most stuck.
        ...(seatedAt ? { seatedAt } : {}),
      });
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
