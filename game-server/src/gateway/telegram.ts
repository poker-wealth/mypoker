import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verification of the Telegram Mini App `initData` launch payload.
 *
 * This is the trust boundary for the whole product: the signature proves Telegram
 * vouches for the identity, so everything downstream — the player account, the
 * wallet, the JWT — hangs off it being checked correctly. Nothing here trusts a
 * field before the HMAC has been validated.
 *
 * Telegram's scheme (https://core.telegram.org/bots/webapps#validating-data):
 *   secret_key = HMAC_SHA256(key = "WebAppData", data = bot_token)
 *   hash       = HMAC_SHA256(key = secret_key,   data = data_check_string)
 * where data_check_string is every field except `hash`, formatted `key=value`,
 * sorted by key, joined with newlines.
 */

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
  is_premium?: boolean;
}

export type InitDataResult =
  | { ok: true; user: TelegramUser; authDate: number }
  | { ok: false; reason: string };

interface VerifyOptions {
  /** Reject payloads older than this. Telegram suggests ~1 day. */
  maxAgeSeconds: number;
  /** Injectable clock, in seconds, so freshness is testable. */
  nowSeconds?: number;
}

export function verifyInitData(
  initData: string,
  botToken: string,
  options: VerifyOptions,
): InitDataResult {
  if (!botToken) return { ok: false, reason: 'server has no bot token configured' };
  if (!initData) return { ok: false, reason: 'initData is empty' };

  const params = new URLSearchParams(initData);

  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'initData has no hash' };
  params.delete('hash');

  // Sort by key, not by the joined "key=value" string — the spec is explicit that
  // the ordering is alphabetical on the field name.
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (!timingSafeEqualHex(expected, hash)) {
    return { ok: false, reason: 'signature does not match' };
  }

  // ── Only past this point is any field trustworthy ────────────────────────────

  const authDateRaw = params.get('auth_date');
  const authDate = Number(authDateRaw);
  if (!authDateRaw || !Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, reason: 'initData has no usable auth_date' };
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (now - authDate > options.maxAgeSeconds) {
    return { ok: false, reason: 'initData has expired' };
  }

  const userJson = params.get('user');
  if (!userJson) return { ok: false, reason: 'initData has no user' };

  let user: TelegramUser;
  try {
    user = JSON.parse(userJson) as TelegramUser;
  } catch {
    return { ok: false, reason: 'initData user is not valid JSON' };
  }
  if (typeof user.id !== 'number' || !Number.isFinite(user.id)) {
    return { ok: false, reason: 'initData user has no numeric id' };
  }

  return { ok: true, user, authDate };
}

/**
 * The player id we derive from a Telegram identity.
 *
 * Deliberately deterministic: the Telegram user id *is* the identity, so there's
 * no mapping table to keep, and financial-core creates the matching account
 * lazily on first use. No identity storage exists on the game server as a result.
 */
export function playerIdForTelegramUser(telegramUserId: number): string {
  return `tg-${telegramUserId}`;
}

/** Best-effort display name from the Telegram profile fields. */
export function displayNameFor(user: TelegramUser): string {
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.username || `Player ${user.id}`;
}

/** Constant-time compare of two hex digests, tolerant of length/case mismatch. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b.toLowerCase(), 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}
