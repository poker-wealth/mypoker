import { Router, type Request, type Response } from 'express';
import { requireAuth, requireAdmin } from './auth';
import type { GatewayConfig } from './config';

/**
 * The admin API (SAMUEL.md task 3).
 *
 * Two layers of authority, and they answer different questions:
 *
 *   requireAuth + requireAdmin — WHO is asking, and are they ops. Identity
 *     lives here in the gateway, so this is the only place that can tell.
 *   the internal secret, added below — that the caller of financial-core is a
 *     service rather than a browser. financial-core has no idea what an
 *     administrator is, by design.
 *
 * The browser therefore never holds the internal secret and never addresses
 * financial-core directly. It presents an ops token to this router, which
 * vouches for it downstream. Nothing here reads a request's own idea of who it
 * is: `approvedBy` on a withdrawal comes from the verified token, never from
 * the body, or a second signature would be a field the client fills in.
 */
export function buildAdminRouter(config: GatewayConfig): Router {
  const r = Router();

  // Order matters: requireAdmin reads the role requireAuth wrote.
  r.use(requireAuth(config));
  r.use(requireAdmin());

  /** Call financial-core with the service secret. */
  const internal = async <T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<{ ok: true; body: T } | { ok: false; status: number; error: string }> => {
    const hasBody = init.body !== undefined;
    try {
      const upstream = await fetch(`${config.financialCoreUrl}/api/v1${path}`, {
        method: init.method ?? 'GET',
        headers: {
          'x-internal-secret': config.internalApiSecret,
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
        },
        ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
      });
      const body: unknown = await upstream.json().catch(() => null);
      if (!upstream.ok || body === null) {
        const detail =
          body && typeof body === 'object' && 'error' in body
            ? String((body as { error: unknown }).error)
            : 'financial service unavailable';
        return { ok: false, status: upstream.status || 502, error: detail };
      }
      return { ok: true, body: body as T };
    } catch (err) {
      console.error('[admin] financial-core unreachable:', err);
      return { ok: false, status: 502, error: 'financial service unavailable' };
    }
  };

  const handle =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response): void => {
      fn(req, res).catch((err: unknown) => {
        console.error('[admin] route failed:', err);
        res.status(500).json({ error: 'admin request failed' });
      });
    };

  /** Screen 1 — Overview. Read-only platform facts. */
  r.get(
    '/overview',
    handle(async (_req, res) => {
      const result = await internal<unknown>('/internal/ops/overview');
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result.body);
    }),
  );

  return r;
}
