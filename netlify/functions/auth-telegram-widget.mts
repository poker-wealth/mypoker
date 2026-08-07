import {
  verifyWidgetData,
  playerIdForTelegramUser,
  displayNameFor,
  type WidgetUser,
} from '../../game-server/src/gateway/telegram';
import { signToken } from '../../game-server/src/gateway/tokens';

/**
 * POST /auth/telegram-widget — exchange a Telegram Login Widget payload for a
 * session. The browser counterpart of auth-telegram.mts: same shape, same JWT,
 * different signature scheme (the widget signs with SHA256(bot_token), the Mini
 * App with HMAC("WebAppData", bot_token)).
 *
 * Imports the SAME verification code the Express gateway uses, for the same
 * reason auth-telegram.mts does: a second copy of signature verification would
 * drift, and drift there means signing in as someone else.
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
    console.error('[auth-telegram-widget] missing TELEGRAM_BOT_TOKEN or JWT_SECRET');
    return json({ error: 'sign-in is not configured on the server' }, 500);
  }

  let widgetData: unknown;
  try {
    widgetData = await req.json();
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  if (
    typeof widgetData !== 'object' ||
    widgetData === null ||
    typeof (widgetData as { hash?: unknown }).hash !== 'string'
  ) {
    return json({ error: 'invalid widget data' }, 400);
  }

  const result = verifyWidgetData(widgetData as WidgetUser, botToken, {
    maxAgeSeconds: maxAge,
  });
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
