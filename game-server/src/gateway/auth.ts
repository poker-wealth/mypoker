import { Router, type NextFunction, type Request, type Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import type { GatewayConfig } from './config';
import { userStore } from '../auth/user-store';
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
  /** 'ops' for a platform administrator; 'player' for everyone else. */
  role: 'player' | 'ops';
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
    // Telegram sign-in never grants ops — admin authority comes only through the
    // email/password path (a Telegram player can never become an administrator).
    role: 'player',
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

/**
 * Rejects anyone who is not a platform administrator.
 *
 * The `ops` role has been carried in the token type since the gateway was
 * written and enforced by nothing — `requireAuth` reads it onto `req.player`
 * and no route has ever looked at it. This is the first check, so it is worth
 * being exact about what it does and does not mean.
 *
 * Stack it AFTER `requireAuth`, never instead of it: this reads the role that
 * middleware put there, so on its own it would authorise an unauthenticated
 * request whose `req.player` is undefined. Ordering is the whole guard.
 *
 * 404, not 403, on the role check. A 403 confirms the admin API exists and
 * that this account simply lacks the rank — which tells someone probing with a
 * stolen player token exactly what to go after next. A missing token still
 * gets 401 from `requireAuth`, because that is a statement about the request
 * rather than about what lies behind it.
 *
 * `league_admin` is deliberately NOT accepted. The spec gives league
 * administrators their OWN panel, scoped to their alliance — "league overview
 * (volume, rake, player list, Jackpot balances)… player risk scores visible to
 * league admin (for their own league players only)" (12-week plan, W10). The
 * platform's withdrawal queue, player list and treasury are a different scope,
 * and that panel is a separate build, not this one with a wider role check.
 */
export function requireAdmin() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.player?.role !== 'ops') {
      res.status(404).json({ error: 'not found' });
      return;
    }
    next();
  };
}

export function buildAuthRouter(config: GatewayConfig): Router {
  const r = Router();

  // Web identity (email/password + Google) — the browser sign-in path. The user
  // store lives HERE in the gateway (financial-core is money-only and just
  // verifies the JWT). This verifies the Google token / checks credentials, then
  // signs the same JWT every other login flavour gets.
  const authClient = userStore;
  const googleClient = new OAuth2Client();

  // The token's role is the profile's role — so an admin who signs in with
  // email/password gets an `ops` token, and everyone else a `player` one. This
  // is the ONLY place `ops` enters a token, and only via the credential login
  // below (signup and Google always resolve to a player profile).
  const issue = (player: PlayerProfile): { token: string; player: PlayerProfile } => ({
    token: signToken(
      { playerId: player.playerId, role: player.role },
      config.jwtSecret,
      config.jwtTtlSeconds,
    ),
    player,
  });

  const asProfile = (u: {
    playerId: string;
    displayName?: string;
    email?: string;
    photoUrl?: string | null;
    role?: 'ops';
  }): PlayerProfile => ({
    playerId: u.playerId,
    displayName: u.displayName || u.email?.split('@')[0] || 'Player',
    username: u.email?.split('@')[0] ?? null,
    photoUrl: u.photoUrl ?? null,
    telegramId: null,
    vipTier: 0,
    role: u.role === 'ops' ? 'ops' : 'player',
  });

  r.post('/signup', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const email = body['email'] || body['phone'] || body['identifier'];
    const password = body['password'];
    const displayName = body['displayName'];

    if (!email || !password) {
      res.status(400).json({ error: 'email or phone number and password are required' });
      return;
    }
    authClient
      .signup(email, password, displayName)
      .then((u) => res.json(issue(asProfile(u))))
      .catch((err: Error) => res.status(400).json({ error: err.message }));
  });

  r.post('/login', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const email = body['email'] || body['phone'] || body['identifier'];
    const password = body['password'];

    if (!email || !password) {
      res.status(400).json({ error: 'email or phone number and password are required' });
      return;
    }
    authClient
      .verifyPassword(email, password)
      .then((u) => res.json(issue(asProfile(u))))
      .catch((err: Error) => res.status(401).json({ error: err.message }));
  });

  r.post('/google', async (req: Request, res: Response) => {
    try {
      // Every OAuth client we accept a token from — web, Android, iOS. Comma
      // separated in GOOGLE_CLIENT_ID.
      const allowedClientIds = (process.env['GOOGLE_CLIENT_ID'] ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

      // An empty allow-list used to mean "accept any Google token from any
      // application" — verifyIdToken was simply skipped, and the userinfo
      // fallback trusts whoever the token names without ever checking which
      // client it was issued to. That is the account-takeover bug this fixes.
      // Refusing outright is the only safe reading of "not configured": fail
      // closed, and do it before the token is even looked at.
      if (allowedClientIds.length === 0) {
        res.status(503).json({ error: 'Google sign-in is not configured' });
        return;
      }

      const { idToken, token, credential } = (req.body ?? {}) as Record<string, string>;
      const accessToken = credential || token || idToken;
      if (!accessToken) {
        res.status(400).json({ error: 'Token is required' });
        return;
      }

      let payload: { sub: string; email: string; name?: string; picture?: string } | null = null;

      // A JWT idToken verifies offline; the implicit-flow access_token instead
      // resolves through Google's tokeninfo + userinfo endpoints. Tell them
      // apart by shape (three dot-separated segments), since a JWT that fails
      // audience verification must be rejected outright, never silently
      // retried as an access token.
      const looksLikeJwt = accessToken.split('.').length === 3;

      if (looksLikeJwt) {
        try {
          const ticket = await googleClient.verifyIdToken({
            idToken: accessToken,
            audience: allowedClientIds,
          });
          const p = ticket.getPayload();
          if (p?.email) payload = { sub: p.sub, email: p.email, ...(p.name ? { name: p.name } : {}), ...(p.picture ? { picture: p.picture } : {}) };
        } catch {
          // Well-formed JWT, but it failed verification (bad signature, wrong
          // audience, expired, ...) — reject it outright rather than falling
          // through to the access-token path.
          res.status(401).json({ error: 'Invalid Google token' });
          return;
        }
      } else {
        // Access tokens carry no audience of their own. userinfo reports WHOSE
        // token it is but not which client it was issued to, so on its own it
        // cannot answer "did our app request this?" — that's what tokeninfo's
        // `aud` field is for. Only once that has been checked against the
        // allow-list is it safe to call userinfo for the display profile.
        const tokenInfoRes = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
        );
        if (!tokenInfoRes.ok) {
          res.status(401).json({ error: 'Invalid Google token' });
          return;
        }
        const tokenInfo = (await tokenInfoRes.json()) as Record<string, string>;
        if (!tokenInfo['aud'] || !allowedClientIds.includes(tokenInfo['aud'])) {
          res.status(401).json({ error: 'Invalid Google token' });
          return;
        }

        const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userinfoRes.ok) {
          const info = (await userinfoRes.json()) as Record<string, string>;
          if (info['email'] && info['sub']) {
            const displayName = info['name'] || info['given_name'] || info['email'].split('@')[0] || 'Player';
            payload = {
              sub: info['sub'],
              email: info['email'],
              name: displayName,
              ...(info['picture'] ? { picture: info['picture'] } : {}),
            };
          }
        }
      }

      if (!payload) {
        res.status(401).json({ error: 'Invalid Google token' });
        return;
      }

      const u = await authClient.oauth(payload.sub, payload.email, payload.name, payload.picture);
      res.json(issue(asProfile(u)));
    } catch (err) {
      console.error('[auth] Google authentication error:', err);
      res.status(401).json({ error: err instanceof Error ? err.message : 'Google authentication failed' });
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
      role: 'player',
    };
    const token = signToken(
      { playerId: player.playerId, role: 'player' },
      config.jwtSecret,
      config.jwtTtlSeconds,
    );
    res.json({ token, player });
  });

  // ── Who am I ─────────────────────────────────────────────────────────────────
  // Confirms a stored token is still good after a reload.
  r.get('/me', requireAuth(config), async (req: Request, res: Response) => {
    try {
      const playerId = req.player!.playerId;
      const telegramId = playerId.startsWith('tg-') ? Number(playerId.slice(3)) : NaN;

      // A missing document is not an error here — Telegram players never have
      // one (see the comment on `userStore.search`): their playerId is derived
      // from the Telegram user id and nothing is ever written for them. For
      // that case only, the profile is derived from the token itself, same as
      // before this lookup existed.
      const stored = await userStore.byPlayerId(playerId);

      res.json({
        playerId,
        displayName: stored?.displayName || playerId,
        username: null,
        photoUrl: stored ? stored.photoUrl ?? null : null,
        telegramId: Number.isFinite(telegramId) ? telegramId : null,
        vipTier: 0,
        // The role rides on the verified token; surfacing it lets the client
        // decide whether to render the admin panel or the player app.
        role: req.player!.role === 'ops' ? 'ops' : 'player',
      } satisfies PlayerProfile);
    } catch (err) {
      console.error('[auth] /me lookup failed:', err);
      res.status(500).json({ error: 'internal error' });
    }
  });

  return r;
}
