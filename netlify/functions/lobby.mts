import { seedLobby, parseTableFilter, FilterError } from '../../game-server/src/lobby';

/**
 * GET /lobby/games, /lobby/tables, /lobby/tables/:id
 *
 * The lobby can run serverless today because the LobbyService it reads is
 * currently a static seed — constructed identically on every invocation, never
 * mutated. So a function returns exactly what the Express gateway returns.
 *
 * That stops being true the moment the game loop owns the lobby and tables start
 * filling and emptying for real. At that point this function has to be replaced
 * by the running gateway; live state cannot be reconstructed per request. It is
 * a deliberate stopgap so the Lobby screen has real endpoints to develop
 * against without waiting on a host.
 *
 * Imports the same seed and filter parser as the gateway rather than
 * reimplementing either — two versions of "what the lobby looks like" would
 * drift into showing different tables depending on which one answered.
 *
 * Everything it reaches is dependency-free (node builtins only). Netlify leaves
 * bare imports external, so a third-party package anywhere in this import graph
 * fails at runtime with module-not-found rather than at build time.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Public, unchanging data. A short cache spares the function on the
      // lobby's polling without ever showing meaningfully stale numbers.
      'cache-control': 'public, max-age=10',
    },
  });

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  const url = new URL(req.url);
  // Netlify rewrites /lobby/* here, so strip whichever prefix survived.
  const path = url.pathname
    .replace(/^\/\.netlify\/functions\/lobby/, '')
    .replace(/^\/lobby/, '')
    .replace(/\/$/, '');

  const lobby = seedLobby();

  if (path === '' || path === '/games') {
    return json({ games: lobby.listGames(), totalJackpot: lobby.totalJackpot() });
  }

  if (path === '/tables') {
    try {
      const tables = lobby.listTables(parseTableFilter(Object.fromEntries(url.searchParams)));
      return json({ tables, count: tables.length });
    } catch (err) {
      if (err instanceof FilterError) return json({ error: err.message }, 400);
      throw err;
    }
  }

  const tableMatch = /^\/tables\/([^/]+)$/.exec(path);
  if (tableMatch) {
    const table = lobby.getTable(decodeURIComponent(tableMatch[1]!));
    return table ? json(table) : json({ error: 'table not found' }, 404);
  }

  return json({ error: 'not found' }, 404);
};
