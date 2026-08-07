import { Router, type Request, type Response } from 'express';
import { requireAuth } from './auth';
import type { GatewayConfig } from './config';
import { forwardTo } from './me-routes';

/**
 * Alliance routes.
 *
 * Discovery and reading one league are open — an alliance list is a shop window,
 * and requiring a session to browse it would put a sign-up wall in front of the
 * thing meant to attract people.
 *
 * Creating, joining and leaving require a token. financial-core takes the owner
 * from that token rather than the body, so a caller cannot found a league in
 * someone else's name however the request is shaped.
 */
/** Encoded upstream path for the requested league. Express widens params to
 *  string | string[]; a league id is always a single segment. */
function leaguePath(req: Request): string {
  const id = String(req.params.leagueId ?? '');
  return `/leagues/${encodeURIComponent(id)}`;
}

export function buildLeagueRouter(config: GatewayConfig): Router {
  const r = Router();

  r.get('/', (req, res) => void forwardTo(config, req, res, '/leagues'));
  r.get('/:leagueId', (req, res) => void forwardTo(config, req, res, leaguePath(req)));

  r.post('/', requireAuth(config), (req: Request, res: Response) =>
    void forwardTo(config, req, res, '/leagues'),
  );
  r.post('/:leagueId/join', requireAuth(config), (req: Request, res: Response) =>
    void forwardTo(config, req, res, `${leaguePath(req)}/join`),
  );
  r.post('/:leagueId/leave', requireAuth(config), (req: Request, res: Response) =>
    void forwardTo(config, req, res, `${leaguePath(req)}/leave`),
  );

  return r;
}
