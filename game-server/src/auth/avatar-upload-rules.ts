/**
 * Avatar-upload rate limiting.
 *
 * Same shape as `otp-rules.ts`, deliberately: a pure function of (stored
 * state, now), no database and no clock of its own, so `avatar-upload-store.ts`
 * is a thin Mongoose adapter with no decisions in it and this is testable
 * without standing up Mongo. Uploads have no send/verify distinction — every
 * accepted upload counts against a rolling ceiling, with a short cooldown so
 * a script cannot fire uploads back to back. Without this, one player could
 * fill the avatars collection (or just churn the re-encode work) as fast as
 * the network allows.
 */

/** Minimum gap between two accepted uploads from the same player. */
export const AVATAR_UPLOAD_COOLDOWN_MS = 15_000;

/** Uploads allowed inside one rolling window — the anti-fill-the-database ceiling. */
export const AVATAR_UPLOAD_MAX_PER_WINDOW = 10;

export const AVATAR_UPLOAD_WINDOW_MS = 60 * 60_000; // 1 hour

/** What is persisted per player between requests. */
export interface UploadHistory {
  /** Uploads counted in the current window. */
  count: number;
  /** When the current window started. */
  windowStart: number;
  lastUploadAt: number;
}

export type UploadDecision =
  | { ok: true }
  | { ok: false; reason: 'cooldown' | 'too_many_uploads'; retryAfterMs: number };

/**
 * May this player's upload go ahead right now?
 *
 * `existing` is null for a player's first-ever upload, always allowed. A
 * window that has fully elapsed is a clean slate — the caller starts counting
 * again from this request — otherwise the cooldown is checked first (it is
 * the tighter, more immediate limit) and the rolling ceiling second.
 */
export function canUpload(existing: UploadHistory | null, now: number): UploadDecision {
  if (!existing) return { ok: true };

  const windowExpired = now >= existing.windowStart + AVATAR_UPLOAD_WINDOW_MS;
  if (windowExpired) return { ok: true };

  const readyAt = existing.lastUploadAt + AVATAR_UPLOAD_COOLDOWN_MS;
  if (now < readyAt) {
    return { ok: false, reason: 'cooldown', retryAfterMs: readyAt - now };
  }
  if (existing.count >= AVATAR_UPLOAD_MAX_PER_WINDOW) {
    return {
      ok: false,
      reason: 'too_many_uploads',
      retryAfterMs: existing.windowStart + AVATAR_UPLOAD_WINDOW_MS - now,
    };
  }
  return { ok: true };
}

/** The state to persist after an upload that `canUpload` allowed. */
export function afterUpload(existing: UploadHistory | null, now: number): UploadHistory {
  if (existing && now < existing.windowStart + AVATAR_UPLOAD_WINDOW_MS) {
    return { count: existing.count + 1, windowStart: existing.windowStart, lastUploadAt: now };
  }
  // No prior history, or the window fully elapsed: start counting fresh.
  return { count: 1, windowStart: now, lastUploadAt: now };
}
