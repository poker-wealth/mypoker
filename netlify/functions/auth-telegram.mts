import {
  verifyInitData,
  playerIdForTelegramUser,
  displayNameFor,
} from '../../game-server/src/gateway/telegram';
import { signToken } from '../../game-server/src/gateway/tokens';

/**
 * POST /auth/telegram — exchange a signed Telegram launch payload for a session.
 *
 * Login is a pure function of `initData` — verify the HMAC, derive the player id,
 * sign a JWT — so it needs no database and no long-running process, and runs here
 * on the same Netlify site that serves the app.
 *
 * It deliberately imports the SAME verification code the Express gateway uses
 * (game-server/src/gateway/) rather than reimplementing it. That code is
 * dependency-free and covered by 31 tests; a second copy would drift, and drift
 * in signature verification is how people get signed in as someone else.
 *
 * Required env (Netlify site config, never in git):
 *   TELEGRAM_BOT_TOKEN — the player-facing bot, from @BotFather
 *   JWT_SECRET         — must match financial-core's JWT_SECRET exactly
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const jwtSecret = process.env.JWT_SECRET ?? '';
  const ttl = Number(process.env.JWT_TTL_SECONDS ?? 86_400);
  const maxAge = Number(process.env.TELEGRAM_INITDATA_MAX_AGE_SECONDS ?? 86_400);

  // Signing with an empty secret would make every token forgeable — refuse rather
  // than issue one. Same reasoning as the gateway's boot-time guard.
  if (!jwtSecret || !botToken) {
    console.error('[auth-telegram] missing TELEGRAM_BOT_TOKEN or JWT_SECRET');
    return json({ error: 'sign-in is not configured on the server' }, 500);
  }

  let initData: unknown;
  try {
    initData = ((await req.json()) as { initData?: unknown } | null)?.initData;
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  if (typeof initData !== 'string' || !initData) {
    return json({ error: 'initData is required' }, 400);
  }

  const result = verifyInitData(initData, botToken, { maxAgeSeconds: maxAge });
  if (!result.ok) return json({ error: result.reason }, 401);

  const player = {
    playerId: playerIdForTelegramUser(result.user.id),
    displayName: displayNameFor(result.user),
    username: result.user.username ?? null,
    photoUrl: result.user.photo_url ?? null,
    telegramId: result.user.id,
    vipTier: 0,
  };

  const token = signToken({ playerId: player.playerId, role: 'player' }, jwtSecret, ttl);
  return json({ token, player });
};
