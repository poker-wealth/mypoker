import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { FilterError } from '../lobby';
import type { GatewayConfig } from './config';
import { buildAuthRouter } from './auth';
import { buildLobbyRouter } from './lobby-routes';
import { buildJackpotRouter } from './jackpot-routes';
import { buildLeagueRouter } from './league-routes';
import { buildMeRouter } from './me-routes';
import type { LobbyService } from '../lobby';

/**
 * The gateway HTTP app — the only backend surface the Mini App talks to.
 *
 * Note this is *not* `scripts/app-server.ts`, which is a demo harness serving its
 * own UI over in-memory play money with no authentication. This is the real
 * client-facing API: authenticated, and delegating every money operation to the
 * Financial Core.
 */
export function createGatewayApp(config: GatewayConfig, lobby?: LobbyService): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors(config.corsOrigins));
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'game-server-gateway' });
  });

  app.use('/auth', buildAuthRouter(config));
  app.use('/me', buildMeRouter(config));
  app.use('/leagues', buildLeagueRouter(config));
  // Optional so auth-only deployments (and the auth tests) don't have to stand
  // up a lobby they never read.
  if (lobby) app.use('/lobby', buildLobbyRouter(lobby));
  // Jackpot pools are derived from the same tables, so it shares the gate.
  if (lobby) app.use('/jackpot', buildJackpotRouter(lobby));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not found' });
  });

  // Final guard: never let a stack trace reach a client.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof FilterError) {
      res.status(400).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'internal error';
    console.error('[gateway] unhandled error:', message);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

/**
 * Origin allow-list. An empty list means "same-origin only" — no `*`, because the
 * client sends a bearer token and a wildcard would let any page on the internet
 * call the API with a user's credentials if it ever got hold of one.
 */
function cors(allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(origin && allowed.includes(origin) ? 204 : 403);
      return;
    }
    next();
  };
}
