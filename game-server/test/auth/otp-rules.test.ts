import {
  canAttempt,
  canSend,
  expiryFrom,
  generateCode,
  looksLikeCode,
  resendAvailableAt,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  type OtpChallenge,
} from '../../src/auth/otp-rules';

/**
 * The confirmation rules, on their own.
 *
 * These are the decisions — everything else in the flow is plumbing around
 * them. They take a clock as an argument, so nothing here waits and nothing
 * here is flaky.
 */

const T0 = 1_700_000_000_000;

const challenge = (over: Partial<OtpChallenge> = {}): OtpChallenge => ({
  codeHash: 'irrelevant-here',
  attempts: 0,
  sends: 1,
  lastSentAt: T0,
  expiresAt: T0 + OTP_TTL_MS,
  ...over,
});

describe('generateCode', () => {
  it('is always exactly OTP_LENGTH digits, leading zeros included', () => {
    // 400 draws: the chance of never seeing the property hold is nil, and the
    // point is the padding — a range-shifted generator would pass a "6 digits"
    // check while silently never producing 0xxxxx.
    for (let i = 0; i < 400; i++) {
      const code = generateCode();
      expect(code).toHaveLength(OTP_LENGTH);
      expect(code).toMatch(/^\d+$/);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateCode()));
    // A constant or near-constant generator is the failure that matters, and it
    // would collapse this set to a handful of values.
    expect(seen.size).toBeGreaterThan(180);
  });
});

describe('looksLikeCode', () => {
  it.each([
    ['123456', true],
    ['000000', true],
    ['12345', false],
    ['1234567', false],
    ['12345a', false],
    ['', false],
    ['  123456  ', false],
  ])('%s -> %s', (input, expected) => {
    expect(looksLikeCode(input)).toBe(expected);
  });
});

describe('canSend', () => {
  it('allows the first send of a signup', () => {
    expect(canSend(null, T0)).toEqual({ ok: true });
  });

  it('refuses a second send inside the cooldown, and says how long is left', () => {
    const decision = canSend(challenge(), T0 + 20_000);
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('unreachable');
    expect(decision.reason).toBe('cooldown');
    expect(decision.retryAfterMs).toBe(OTP_RESEND_COOLDOWN_MS - 20_000);
  });

  it('allows a resend once the cooldown has elapsed', () => {
    expect(canSend(challenge(), T0 + OTP_RESEND_COOLDOWN_MS)).toEqual({ ok: true });
  });

  it('refuses once the send ceiling is reached, however long since the last one', () => {
    const spent = challenge({ sends: OTP_MAX_SENDS, lastSentAt: T0 });
    const decision = canSend(spent, T0 + OTP_RESEND_COOLDOWN_MS * 5);
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('unreachable');
    expect(decision.reason).toBe('too_many_sends');
  });

  it('treats a lapsed challenge as a clean slate, ceiling and cooldown alike', () => {
    // Someone who exhausted their sends an hour ago and gave up must be able to
    // start again. Carrying the old counters past expiry would lock the address
    // out with nothing on screen explaining why.
    const spent = challenge({ sends: OTP_MAX_SENDS, expiresAt: T0 + OTP_TTL_MS });
    expect(canSend(spent, T0 + OTP_TTL_MS)).toEqual({ ok: true });
    expect(canSend(spent, T0 + OTP_TTL_MS + 3_600_000)).toEqual({ ok: true });
  });
});

describe('canAttempt', () => {
  it('allows a guess against a fresh challenge', () => {
    expect(canAttempt(challenge(), T0 + 1_000)).toEqual({ ok: true });
  });

  it('refuses exactly at expiry, not a moment after', () => {
    const c = challenge();
    expect(canAttempt(c, c.expiresAt - 1)).toEqual({ ok: true });
    expect(canAttempt(c, c.expiresAt)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses once the attempt cap is reached', () => {
    expect(canAttempt(challenge({ attempts: OTP_MAX_ATTEMPTS - 1 }), T0)).toEqual({ ok: true });
    expect(canAttempt(challenge({ attempts: OTP_MAX_ATTEMPTS }), T0)).toEqual({
      ok: false,
      reason: 'too_many_attempts',
    });
  });

  it('reports expiry before the attempt cap when both apply', () => {
    // Not arbitrary: "that code has expired, request a new one" is actionable
    // and true; "too many incorrect codes" would blame the player for a clock.
    const dead = challenge({ attempts: OTP_MAX_ATTEMPTS, expiresAt: T0 });
    expect(canAttempt(dead, T0 + 1)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('the clock helpers', () => {
  it('expiryFrom is now plus the TTL', () => {
    expect(expiryFrom(T0)).toBe(T0 + OTP_TTL_MS);
  });

  it('resendAvailableAt is the last send plus the cooldown', () => {
    expect(resendAvailableAt(T0)).toBe(T0 + OTP_RESEND_COOLDOWN_MS);
  });

  it('leaves room for at least two resends inside one code lifetime', () => {
    // If the cooldown ever grew past the TTL, "resend" would only ever be
    // reachable after the code it replaces had already died — a dead end that
    // no single-rule test would catch.
    expect(OTP_RESEND_COOLDOWN_MS * 2).toBeLessThan(OTP_TTL_MS);
  });
});
