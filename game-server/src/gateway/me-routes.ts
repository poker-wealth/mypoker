import { Router, type Request, type Response } from 'express';
import type { GatewayConfig } from './config';
import { requireAuth } from './auth';
import {
  scoreFor,
  tierOf,
  DEDUCTION,
  NORMAL_ROUNDS_TO_GOOD,
  vipProgress,
  estimateDaysToNextTier,
  daysElapsedThisMonth,
  type FindingReason,
} from '../players/index';

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
  // Reputation and VIP: financial-core returns FACTS (rounds, findings, volume)
  // and the canonical rules in src/players/ turn them into a score, band, tier
  // and progress HERE — one home for the rules, so a second copy cannot drift.
  // A copy that grew in financial-core had already diverged (its VIP titles
  // predated the owner's Jul 15 renaming) by the time it was found.
  r.get('/reputation', requireAuth(config), (req: Request, res: Response) => {
    void (async () => {
      const facts = await upstreamJson<ReputationFactsShape>(config, req, '/me/reputation');
      if (!facts.ok) return sendUpstreamError(res, facts);

      const { roundsPlayed, findings } = facts.body;
      const score = scoreFor(roundsPlayed, findings);
      res.json({
        score,
        band: tierOf(score),
        roundsPlayed,
        roundsToAdvance: Math.max(0, NORMAL_ROUNDS_TO_GOOD - roundsPlayed),
        deducted: findings.reduce((sum, f) => sum + DEDUCTION[f], 0),
      });
    })();
  });

  r.get('/vip', requireAuth(config), (req: Request, res: Response) => {
    void (async () => {
      const facts = await upstreamJson<VolumeFactsShape>(config, req, '/me/vip');
      if (!facts.ok) return sendUpstreamError(res, facts);

      const progress = vipProgress(facts.body.cumulativeEffective);
      const now = new Date();
      const estimatedDaysToNextTier = progress.next
        ? estimateDaysToNextTier({
            remaining: progress.next.remaining,
            monthlyEffective: facts.body.monthlyEffective,
            daysElapsed: daysElapsedThisMonth(now),
          })
        : null;

      res.json({ ...progress, ...facts.body, estimatedDaysToNextTier });
    })();
  });
  r.get('/leagues', (req, res) => void forwardTo(config, req, res, '/me/leagues'));
  r.get('/notifications', (req, res) => void forwardTo(config, req, res, '/me/notifications'));
  r.post('/notifications/read', (req, res) => void forwardTo(config, req, res, '/me/notifications/read'));
  r.post('/referral', (req, res) => void forwardTo(config, req, res, '/me/referral'));
  r.get('/settings', (req, res) => void forwardTo(config, req, res, '/me/settings'));
  r.patch('/settings', (req, res) => void forwardTo(config, req, res, '/me/settings'));

  return r;
}

// ── upstream helpers for the shaping routes ──────────────────────────────────

interface ReputationFactsShape {
  roundsPlayed: number;
  findings: FindingReason[];
}

interface VolumeFactsShape {
  cumulativeEffective: number;
  monthlyEffective: number;
  breakdown: unknown[];
}

type UpstreamResult<T> = { ok: true; body: T } | { ok: false; status: number; error: string };

/**
 * Fetch JSON from financial-core with the caller's token, for routes that shape
 * the response rather than pipe it. Same timeout discipline as forwardTo.
 */
async function upstreamJson<T>(
  config: GatewayConfig,
  req: Request,
  path: string,
): Promise<UpstreamResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${config.financialCoreUrl}/api/v1${path}`, {
      headers: { authorization: req.headers.authorization ?? '' },
      signal: controller.signal,
    });
    const body: unknown = await upstream.json().catch(() => null);
    if (!upstream.ok || body === null) {
      return { ok: false, status: upstream.status, error: 'financial service unavailable' };
    }
    return { ok: true, body: body as T };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    console.error('[gateway] financial-core unreachable:', err);
    return { ok: false, status: aborted ? 504 : 502, error: 'financial service unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

function sendUpstreamError(res: Response, failure: { status: number; error: string }): void {
  res.status(failure.status).json({ error: failure.error });
}
