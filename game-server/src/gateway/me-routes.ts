import { Router, type Request, type Response } from 'express';
import type { GatewayConfig } from './config';
import { requireAuth } from './auth';

/**
 * Player-scoped reads: stats and game history.
 *
 * These live in the Financial Core — the ledger is the only per-player record
 * the platform keeps — so the gateway forwards rather than reimplements. The
 * client's own JWT is passed straight through: both services verify the same
 * JWT_SECRET, so the Financial Core scopes the query itself and the gateway
 * never has to be trusted to pass the right player id.
 *
 * That matters. If the gateway sent a playerId of its own choosing over the
 * internal-secret channel, a bug here would read someone else's history. As it
 * stands the token is the authority, and a wrong token simply fails.
 */

/** Guard against a hung Financial Core turning into a hung Mini App. */
const UPSTREAM_TIMEOUT_MS = 8000;

export async function forwardTo(
  config: GatewayConfig,
  req: Request,
  res: Response,
  path: string,
): Promise<void> {
  const url = new URL(`${config.financialCoreUrl}/api/v1${path}`);
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === 'string') url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  // Method and body are forwarded, not assumed: a PATCH arriving here as a GET
  // would read settings back and report success while writing nothing.
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: {
        authorization: req.headers.authorization ?? '',
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(req.body ?? {}) } : {}),
      signal: controller.signal,
    });
    const body: unknown = await upstream.json().catch(() => null);
    res.status(upstream.status).json(body ?? { error: 'upstream returned no body' });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    // 502/504, not 500: the gateway is fine, the service behind it is not, and
    // the client should treat this as retryable rather than as its own error.
    console.error('[gateway] financial-core unreachable:', err);
    res.status(aborted ? 504 : 502).json({ error: 'financial service unavailable' });
  } finally {
    clearTimeout(timer);
  }
}

export function buildMeRouter(config: GatewayConfig): Router {
  const r = Router();
  r.use(requireAuth(config));

  r.get('/stats', (req, res) => void forwardTo(config, req, res, '/me/stats'));
  r.get('/history', (req, res) => void forwardTo(config, req, res, '/me/history'));
  r.get('/reputation', (req, res) => void forwardTo(config, req, res, '/me/reputation'));
  r.get('/leagues', (req, res) => void forwardTo(config, req, res, '/me/leagues'));
  r.get('/settings', (req, res) => void forwardTo(config, req, res, '/me/settings'));
  r.patch('/settings', (req, res) => void forwardTo(config, req, res, '/me/settings'));

  return r;
}
