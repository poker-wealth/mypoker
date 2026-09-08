import {
  canUpload,
  afterUpload,
  AVATAR_UPLOAD_COOLDOWN_MS,
  AVATAR_UPLOAD_MAX_PER_WINDOW,
  AVATAR_UPLOAD_WINDOW_MS,
  type UploadHistory,
} from '../../src/auth/avatar-upload-rules';

/**
 * The avatar-upload rate limit rules, on their own — same shape as
 * otp-rules.test.ts. Pure functions of (stored state, now), so nothing here
 * waits and nothing here is flaky.
 */

const T0 = 1_700_000_000_000;

describe('canUpload', () => {
  it('allows a player with no history', () => {
    expect(canUpload(null, T0)).toEqual({ ok: true });
  });

  it('refuses a second upload inside the cooldown', () => {
    const existing: UploadHistory = { count: 1, windowStart: T0, lastUploadAt: T0 };
    const decision = canUpload(existing, T0 + 1000);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe('cooldown');
      expect(decision.retryAfterMs).toBe(AVATAR_UPLOAD_COOLDOWN_MS - 1000);
    }
  });

  it('allows again once the cooldown has passed, below the window ceiling', () => {
    const existing: UploadHistory = { count: 1, windowStart: T0, lastUploadAt: T0 };
    const decision = canUpload(existing, T0 + AVATAR_UPLOAD_COOLDOWN_MS);
    expect(decision).toEqual({ ok: true });
  });

  it('refuses once the rolling window ceiling is hit, even past the cooldown', () => {
    const existing: UploadHistory = {
      count: AVATAR_UPLOAD_MAX_PER_WINDOW,
      windowStart: T0,
      lastUploadAt: T0 + 5_000,
    };
    const now = T0 + 5_000 + AVATAR_UPLOAD_COOLDOWN_MS;
    const decision = canUpload(existing, now);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe('too_many_uploads');
      expect(decision.retryAfterMs).toBe(T0 + AVATAR_UPLOAD_WINDOW_MS - now);
    }
  });

  it('treats an elapsed window as a clean slate — no carried-over cooldown or count', () => {
    const existing: UploadHistory = {
      count: AVATAR_UPLOAD_MAX_PER_WINDOW,
      windowStart: T0,
      lastUploadAt: T0,
    };
    const decision = canUpload(existing, T0 + AVATAR_UPLOAD_WINDOW_MS);
    expect(decision).toEqual({ ok: true });
  });
});

describe('afterUpload', () => {
  it('starts a fresh window of one for a player with no history', () => {
    expect(afterUpload(null, T0)).toEqual({ count: 1, windowStart: T0, lastUploadAt: T0 });
  });

  it('increments the count within a live window, keeping windowStart fixed', () => {
    const existing: UploadHistory = { count: 3, windowStart: T0, lastUploadAt: T0 + 100 };
    const now = T0 + 200;
    expect(afterUpload(existing, now)).toEqual({ count: 4, windowStart: T0, lastUploadAt: now });
  });

  it('starts a new window once the old one has elapsed', () => {
    const existing: UploadHistory = { count: 9, windowStart: T0, lastUploadAt: T0 };
    const now = T0 + AVATAR_UPLOAD_WINDOW_MS + 1;
    expect(afterUpload(existing, now)).toEqual({ count: 1, windowStart: now, lastUploadAt: now });
  });
});
