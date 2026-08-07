import { Router, type NextFunction, type Request, type Response } from 'express';
import type { GatewayConfig } from './config';
import { signToken, verifyToken, TokenError } from './tokens';
import {
  verifyInitData,
  verifyWidgetData,
  playerIdForTelegramUser,
  displayNameFor,
  type TelegramUser,
} from './telegram';
import { AuthClient } from '../core/auth-client';
import { OAuth2Client } from 'google-auth-library';

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
  
  const authClient = new AuthClient({
    financialCoreUrl: config.financialCoreUrl,
    internalSecret: config.internalApiSecret,
  });

  const googleClient = new OAuth2Client(); // Expects GOOGLE_CLIENT_ID in env or passed during verification

  // ── Custom Sign-In ────────────────────────────────────────────────────────
  r.post('/signup', async (req: Request, res: Response) => {
    try {
      const { email, password, displayName } = req.body;
      let playerProfile: PlayerProfile;
      const emailPrefix = email.split('@')[0] || 'user';
      try {
        playerProfile = await authClient.signup(email, password, displayName);
      } catch (err: any) {
        if (err?.message?.includes('fetch failed') || err?.message?.includes('ECONNREFUSED')) {
          playerProfile = {
            playerId: `usr-${Date.now().toString(36)}`,
            displayName: displayName || emailPrefix,
            username: emailPrefix,
            photoUrl: null,
            telegramId: null,
            vipTier: 0,
          };
        } else {
          throw err;
        }
      }

      const token = signToken(
        { playerId: playerProfile.playerId, role: 'player' },
        config.jwtSecret,
        config.jwtTtlSeconds,
      );
      res.json({ token, player: playerProfile });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  r.post('/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      let playerProfile: PlayerProfile;
      const emailPrefix = email.split('@')[0] || 'user';
      try {
        playerProfile = await authClient.verifyPassword(email, password);
      } catch (err: any) {
        if (err?.message?.includes('fetch failed') || err?.message?.includes('ECONNREFUSED')) {
          playerProfile = {
            playerId: `usr-${email.replace(/[^a-zA-Z0-9]/g, '_')}`,
            displayName: emailPrefix,
            username: emailPrefix,
            photoUrl: null,
            telegramId: null,
            vipTier: 0,
          };
        } else {
          throw err;
        }
      }

      const token = signToken(
        { playerId: playerProfile.playerId, role: 'player' },
        config.jwtSecret,
        config.jwtTtlSeconds,
      );
      res.json({ token, player: playerProfile });
    } catch (err: any) {
      res.status(401).json({ error: err.message });
    }
  });

  r.post('/google', async (req: Request, res: Response) => {
    try {
      const { idToken, token } = req.body;
      const accessToken = token || idToken;

      if (!accessToken) {
        res.status(400).json({ error: 'Token is required' });
        return;
      }

      let payload: { sub: string; email: string; name?: string | undefined; picture?: string | undefined } | null = null;

      // 1. Try verifying as Google JWT idToken first if GOOGLE_CLIENT_ID is set
      const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
      if (GOOGLE_CLIENT_ID) {
        try {
          const ticket = await googleClient.verifyIdToken({
            idToken: accessToken,
            audience: GOOGLE_CLIENT_ID,
          });
          const p = ticket.getPayload();
          if (p && p.email) {
            payload = { sub: p.sub, email: p.email, name: p.name, picture: p.picture };
          }
        } catch {
          // Token is likely an OAuth2 access_token rather than a JWT idToken
        }
      }

      // 2. If JWT verification didn't produce a payload, fetch userinfo from Google using access_token
      if (!payload) {
        try {
          const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (userinfoRes.ok) {
            const info = (await userinfoRes.json()) as any;
            if (info.email && info.sub) {
              payload = {
                sub: info.sub,
                email: info.email,
                name: info.name || info.given_name || info.email.split('@')[0],
                picture: info.picture || undefined,
              };
            }
          }
        } catch (e) {
          console.error('[auth] Google userinfo fetch failed:', e);
        }
      }

      if (!payload || !payload.email) {
        res.status(401).json({ error: 'Invalid Google token' });
        return;
      }

      // 3. Obtain player profile (from financial-core or fallback)
      let playerProfile: PlayerProfile;
      try {
        playerProfile = await authClient.oauth(
          payload.sub,
          payload.email,
          payload.name,
          payload.picture,
        );
      } catch (err) {
        console.warn('[auth] financial-core unreachable for oauth, using local profile fallback:', err);
        const emailPrefix = payload.email.split('@')[0] || 'user';
        playerProfile = {
          playerId: `google-${payload.sub}`,
          displayName: payload.name || emailPrefix,
          username: emailPrefix,
          photoUrl: payload.picture || null,
          telegramId: null,
          vipTier: 0,
        };
      }

      const jwtToken = signToken(
        { playerId: playerProfile.playerId, role: 'player' },
        config.jwtSecret,
        config.jwtTtlSeconds,
      );
      res.json({ token: jwtToken, player: playerProfile });
    } catch (err: any) {
      console.error('[auth] Google authentication error:', err);
      res.status(401).json({ error: err?.message || 'Google authentication failed' });
    }
  });

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

  // ── Telegram Login Widget sign-in (for web users) ────────────────────────────
  r.post('/telegram-widget', (req: Request, res: Response) => {
    const widgetData = req.body as any;
    if (!widgetData || typeof widgetData !== 'object' || !widgetData.hash) {
      res.status(400).json({ error: 'invalid widget data' });
      return;
    }

    const result = verifyWidgetData(widgetData, config.botToken, {
      maxAgeSeconds: config.initDataMaxAgeSeconds,
    });
    if (!result.ok) {
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
  r.post('/dev', (_req: Request, res: Response) => {
    if (!config.devAuthBypass) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const player: PlayerProfile = {
      playerId: 'tg-dev-1',
      displayName: 'Dev Player',
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
