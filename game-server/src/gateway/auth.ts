import { Router, type NextFunction, type Request, type Response } from 'express';
import type { GatewayConfig } from './config';
import { signToken, verifyToken, TokenError } from './tokens';
import {
  verifyInitData,
  playerIdForTelegramUser,
  displayNameFor,
  type TelegramUser,
} from './telegram';

/**
 * Player authentication.
 *
 * The Mini App sends its signed `initData`; we verify it, derive a stable player
 * id from the Telegram user id, and hand back a JWT the Financial Core already
 * knows how to verify. No player rows are written anywhere — financial-core
 * creates the account lazily the first time money is touched.
 */

/** The signed-in player, as the client sees it. */
export interface PlayerProfile {
  playerId: string;
  displayName: string;
  username: string | null;
  photoUrl: string | null;
  telegramId: number | null;
  vipTier: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth`; absent on unauthenticated routes. */
      player?: { playerId: string; role: string };
    }
  }
}

function profileFromTelegram(user: TelegramUser): PlayerProfile {
  return {
    playerId: playerIdForTelegramUser(user.id),
    displayName: displayNameFor(user),
    username: user.username ?? null,
    photoUrl: user.photo_url ?? null,
    telegramId: user.id,
    vipTier: 0,
  };
}

/** Rejects any request without a valid, unexpired player token. */
export function requireAuth(config: GatewayConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'missing bearer token' });
      return;
    }
    try {
      const claims = verifyToken(header.slice('Bearer '.length), config.jwtSecret);
      req.player = { playerId: claims.playerId, role: claims.role ?? 'player' };
      next();
    } catch (e) {
      const reason = e instanceof TokenError ? e.message : 'invalid token';
      res.status(401).json({ error: reason });
    }
  };
}

export function buildAuthRouter(config: GatewayConfig): Router {
  const r = Router();

  // ── Telegram Mini App sign-in ────────────────────────────────────────────────
  r.post('/telegram', (req: Request, res: Response) => {
    const initData = (req.body as { initData?: unknown } | undefined)?.initData;
    if (typeof initData !== 'string' || !initData) {
      res.status(400).json({ error: 'initData is required' });
      return;
    }

    const result = verifyInitData(initData, config.botToken, {
      maxAgeSeconds: config.initDataMaxAgeSeconds,
    });
    if (!result.ok) {
      // Deliberately 401, not 400: this is a failed authentication, and the
      // reason is safe to return — it tells an honest client what to fix and
      // tells an attacker nothing they couldn't determine by trying.
      res.status(401).json({ error: result.reason });
      return;
    }

    const player = profileFromTelegram(result.user);
    const token = signToken(
      { playerId: player.playerId, role: 'player' },
      config.jwtSecret,
      config.jwtTtlSeconds,
    );
    res.json({ token, player });
  });

  // ── Dev sign-in, for working in a plain browser ──────────────────────────────
  r.post('/dev', (req: Request, res: Response) => {
    if (!config.devAuthBypass) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    // An optional playerId, so local work can hold several identities at once.
    // Anything involving two people — league isolation, a table with opponents,
    // an agent and their referral — is untestable with a single fixed id, and
    // the first attempt at verifying league isolation over HTTP passed
    // vacuously because both 'players' were the same account.
    //
    // Dev-only by construction: this handler 404s unless devAuthBypass is set,
    // which is false everywhere deployed.
    const requested = (req.body as { playerId?: unknown } | undefined)?.playerId;
    const playerId =
      typeof requested === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(requested)
        ? requested
        : 'tg-dev-1';

    const player: PlayerProfile = {
      playerId,
      displayName: playerId === 'tg-dev-1' ? 'Dev Player' : playerId,
      username: 'devplayer',
      photoUrl: null,
      telegramId: null,
      vipTier: 0,
    };
    const token = signToken(
      { playerId: player.playerId, role: 'player' },
      config.jwtSecret,
      config.jwtTtlSeconds,
    );
    res.json({ token, player });
  });

  // ── Who am I ─────────────────────────────────────────────────────────────────
  // Confirms a stored token is still good after a reload. The profile fields come
  // from the token holder's id only — display name and photo are re-sent by the
  // client at each login, since Telegram is their source of truth, not us.
  r.get('/me', requireAuth(config), (req: Request, res: Response) => {
    const playerId = req.player!.playerId;
    const telegramId = playerId.startsWith('tg-') ? Number(playerId.slice(3)) : NaN;
    res.json({
      playerId,
      displayName: playerId,
      username: null,
      photoUrl: null,
      telegramId: Number.isFinite(telegramId) ? telegramId : null,
      vipTier: 0,
    } satisfies PlayerProfile);
  });

  return r;
}
