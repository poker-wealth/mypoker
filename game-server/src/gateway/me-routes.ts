import express, { Router, type Request, type Response } from 'express';
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
import {
  processAvatarUpload,
  AvatarRejected,
} from '../uploads/avatar-processing';
import { avatarUploadLimiter as defaultAvatarUploadLimiter } from '../auth/avatar-upload-store';
import type { AvatarUploadLimiter } from '../auth/avatar-upload-store';

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

/** A file that big could never become a valid avatar — refused before it is even buffered. */
const AVATAR_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * Injectable seams for testing the avatar-upload flow — same idea as
 * `AuthDeps` in `./auth`. Defaults to the real rate limiter, so nothing about
 * production wiring changes.
 */
export interface MeRouterDeps {
  avatarUploadLimiter?: AvatarUploadLimiter;
}

export function buildMeRouter(config: GatewayConfig, deps: MeRouterDeps = {}): Router {
  const r = Router();
  const uploadLimiter = deps.avatarUploadLimiter ?? defaultAvatarUploadLimiter;
  r.use(requireAuth(config));

  r.get('/stats', (req, res) => void forwardTo(config, req, res, '/me/stats'));
  r.get('/history', (req, res) => void forwardTo(config, req, res, '/me/history'));

  // Wallet. financial-core owns every balance and the withdrawal state machine;
  // the gateway forwards the player's own token so FC scopes each read/write to
  // that player. No money logic lives here — the deposit address is derived, the
  // balance is read, and a withdrawal is a request FC risk-reviews before any
  // deduction (iron rules #1 and #3).
  r.get('/balance', (req, res) => void forwardTo(config, req, res, '/me/balance'));
  r.get('/deposit-address', (req, res) => void forwardTo(config, req, res, '/me/deposit-address'));
  r.get('/transactions', (req, res) => void forwardTo(config, req, res, '/me/transactions'));
  r.get('/withdrawals', (req, res) => void forwardTo(config, req, res, '/me/withdrawals'));
  r.post('/withdrawals', (req, res) => void forwardTo(config, req, res, '/me/withdrawals'));
  // The REGISTERED withdrawal address (§3.6). Withdrawals may only go to this
  // address, and changing it starts a 48h cooldown — so a stolen session cannot
  // immediately redirect funds. Both halves must be proxied or the rule becomes
  // unusable rather than protective: financial-core refuses every withdrawal
  // until an address exists, and without these routes the app has no way to
  // register one. (It had none: withdrawals returned 403 with nothing a player
  // could do about it.)
  r.get('/withdrawal-address', (req, res) => void forwardTo(config, req, res, '/me/withdrawal-address'));
  r.post('/withdrawal-address', (req, res) => void forwardTo(config, req, res, '/me/withdrawal-address'));
  // Reputation and VIP: financial-core returns FACTS (rounds, findings, volume)
  // and the canonical rules in src/players/ turn them into a score, band, tier
  // and progress HERE — one home for the rules, so a second copy cannot drift.
  // A copy that grew in financial-core had already diverged (its VIP titles
  // predated the owner's Jul 15 renaming) by the time it was found.
  r.get('/reputation', requireAuth(config), (req: Request, res: Response): void => {
    void (async (): Promise<void> => {
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

  r.get('/vip', requireAuth(config), (req: Request, res: Response): void => {
    void (async (): Promise<void> => {
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

  // Avatar upload. `requireAuth` above already covers this route — an
  // unauthenticated POST never reaches the handler. The body is read as raw
  // bytes, capped well before the resize a real photo needs, scoped to this
  // one route rather than raising the gateway's app-wide express.json()
  // limit (see gateway/app.ts) — a bad actor's oversized body is rejected by
  // Express itself before a single byte of it is handed to sharp.
  r.post(
    '/avatar',
    express.raw({ type: () => true, limit: AVATAR_MAX_UPLOAD_BYTES }),
    (req: Request, res: Response) => {
      void handleAvatarUpload(config, uploadLimiter, req, res);
    },
  );

  return r;
}

/**
 * The heavy-lifting behind `POST /me/avatar`.
 *
 * Order matters: rate limit first — the cheapest check, and the one that
 * must run even for an otherwise-perfectly-valid upload — THEN validate and
 * re-encode (the dangerous part, see `uploads/avatar-processing.ts`), THEN
 * hand the SAFE, already-processed bytes to financial-core, the only service
 * with a database a player record can live in. The limiter is only charged
 * once the whole thing actually succeeded, so a rejected or failed attempt
 * does not burn quota the player never got any use from.
 */
async function handleAvatarUpload(
  config: GatewayConfig,
  uploadLimiter: AvatarUploadLimiter,
  req: Request,
  res: Response,
): Promise<void> {
  const playerId = req.player!.playerId;

  const gate = await uploadLimiter.check(playerId);
  if (!gate.ok) {
    const seconds = Math.ceil(gate.retryAfterMs / 1000);
    res.set('Retry-After', String(seconds));
    res.status(429).json({
      error:
        gate.reason === 'cooldown'
          ? `Please wait ${seconds}s before uploading another avatar.`
          : 'Too many avatar uploads. Try again later.',
      code: gate.reason,
    });
    return;
  }

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: 'no image data received', code: 'empty_body' });
    return;
  }

  let processed;
  try {
    processed = await processAvatarUpload(req.body);
  } catch (err) {
    if (err instanceof AvatarRejected) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    console.error('[gateway] avatar processing failed:', err);
    res.status(500).json({ error: 'internal error' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(
      `${config.financialCoreUrl}/api/v1/internal/avatars/${encodeURIComponent(playerId)}`,
      {
        method: 'PUT',
        headers: {
          'x-internal-secret': config.internalApiSecret,
          'content-type': 'application/octet-stream',
        },
        body: processed.data,
        signal: controller.signal,
      },
    );
    if (!upstream.ok) {
      console.error('[gateway] financial-core rejected avatar store:', upstream.status);
      res.status(502).json({ error: 'financial service unavailable' });
      return;
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    console.error('[gateway] financial-core unreachable storing avatar:', err);
    res.status(aborted ? 504 : 502).json({ error: 'financial service unavailable' });
    return;
  } finally {
    clearTimeout(timer);
  }

  // Only counted against the limiter once financial-core actually accepted
  // it — a rejected or failed attempt should not cost quota the player never
  // got any use from.
  await uploadLimiter.record(playerId);

  // Read back the settled settings rather than assert a shape here:
  // whatever financial-core actually persisted (the UPLOADED_AVATAR
  // sentinel, written by saveUploadedAvatar) is what the client should
  // render, and this way that sentinel string lives in exactly one place —
  // financial-core/src/settings/player-settings.ts — rather than being
  // duplicated into this package too.
  const settings = await upstreamJson<{ avatarId: string | null }>(config, req, '/me/settings');
  if (!settings.ok) {
    // The image itself is safely stored; only the confirmation read failed.
    // Say so, rather than a bare 502 that reads as "your upload failed" when
    // it did not.
    res.status(200).json({
      avatarUrl: `/avatars/${encodeURIComponent(playerId)}`,
      settings: null,
      warning: 'avatar stored, but could not read back settings',
    });
    return;
  }

  res.json({ ...settings.body, avatarUrl: `/avatars/${encodeURIComponent(playerId)}` });
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
