import { Router, type Request, type Response } from 'express';
import type { GatewayConfig } from './config';

/**
 * Public avatar images.
 *
 * Unauthenticated by necessity: an avatar is shown to every OTHER player at a
 * table, not just its owner — the same way the curated avatar set's assets
 * are already plain public files bundled with the client. This endpoint
 * reveals nothing a playerId does not already reveal elsewhere (seat lists,
 * chat, notifications, the reputation and VIP reads above all carry it); it
 * only answers "what does this playerId currently look like." Anyone who has,
 * or guesses, a playerId can fetch that player's avatar — there is no
 * per-viewer scoping, matching the threat model of the curated picker.
 *
 * financial-core owns the bytes (see settings/avatar-store.ts); this is a
 * thin proxy, same seam `me-routes.ts` uses for everything else. It exists
 * mainly to own the response headers — the fixed content-type, the nosniff
 * guard, the cache policy — rather than trust financial-core's internal
 * response to carry them correctly for a browser.
 */

const PUBLIC_AVATAR_CONTENT_TYPE = 'image/jpeg';
const UPSTREAM_TIMEOUT_MS = 8000;

export function buildAvatarRouter(config: GatewayConfig): Router {
  const r = Router();

  r.get('/:playerId', (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const playerId = String(req.params.playerId ?? '');
      if (!playerId) {
        res.status(400).json({ error: 'playerId is required' });
        return;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
      try {
        const upstream = await fetch(
          `${config.financialCoreUrl}/api/v1/internal/avatars/${encodeURIComponent(playerId)}`,
          { headers: { 'x-internal-secret': config.internalApiSecret }, signal: controller.signal },
        );

        if (upstream.status === 404) {
          res.status(404).json({ error: 'no uploaded avatar' });
          return;
        }
        if (!upstream.ok) {
          console.error('[gateway] financial-core avatar fetch failed:', upstream.status);
          res.status(502).json({ error: 'financial service unavailable' });
          return;
        }

        const bytes = Buffer.from(await upstream.arrayBuffer());

        // Every header here is FIXED — none is copied from the upstream
        // response or derived from the request. That is deliberate: even if
        // the stored row were ever corrupted or replaced with something
        // other than a JPEG, a browser is still told, authoritatively, that
        // it is one, and told not to sniff past that claim.
        res.setHeader('Content-Type', PUBLIC_AVATAR_CONTENT_TYPE);
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // Public — no per-viewer variance — and short enough that a
        // re-upload is visible again within a few minutes without needing a
        // cache-busting query param on every client.
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.status(200).send(bytes);
      } catch (err) {
        const aborted = err instanceof Error && err.name === 'AbortError';
        console.error('[gateway] financial-core unreachable serving avatar:', err);
        res.status(aborted ? 504 : 502).json({ error: 'financial service unavailable' });
      } finally {
        clearTimeout(timer);
      }
    })();
  });

  return r;
}
