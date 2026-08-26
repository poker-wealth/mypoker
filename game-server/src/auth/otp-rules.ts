import { randomInt } from 'node:crypto';

/**
 * The email-confirmation rules, with no database and no clock of their own.
 *
 * Everything here is a pure function of (stored challenge, now). That is
 * deliberate: `otp-store.ts` is then a thin Mongoose adapter with no decisions
 * in it, and every rule below — expiry, the attempt cap, the resend cooldown,
 * the send ceiling — is testable without standing up Mongo. The rules are the
 * part that can be wrong in a way nobody notices.
 *
 * `now` is passed in rather than read here for the same reason.
 */

/** Digits in a code. Six is the length every authenticator app trained people on. */
export const OTP_LENGTH = 6;

/** How long a code stays good. */
export const OTP_TTL_MS = 10 * 60_000;

/**
 * Wrong guesses before the challenge is dead.
 *
 * Six digits is 1,000,000 codes; five guesses is a 1-in-200,000 chance per
 * challenge. The cap is what makes a short numeric code safe at all — without
 * it the code length is the only thing between an attacker and the account,
 * and 1,000,000 requests is minutes of scripting.
 */
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Codes that may be sent for one challenge, across the original and every
 * resend. This is the anti-mail-bomb ceiling: without it, anyone can point
 * signup at a stranger's address and press resend until their inbox is unusable
 * and our domain is on a blocklist.
 */
export const OTP_MAX_SENDS = 5;

/** Minimum gap between sends, so "resend" cannot be held down. */
export const OTP_RESEND_COOLDOWN_MS = 60_000;

/** The stored challenge, as the rules need to see it. */
export interface OtpChallenge {
  codeHash: string;
  /** Wrong guesses so far. */
  attempts: number;
  /** Codes sent so far, including the first. */
  sends: number;
  lastSentAt: number;
  expiresAt: number;
}

export type SendDecision =
  | { ok: true }
  | { ok: false; reason: 'cooldown' | 'too_many_sends'; retryAfterMs: number };

export type VerifyDecision =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'too_many_attempts' };

/**
 * A fresh code.
 *
 * `randomInt` from node:crypto, never `Math.random()` — this is a credential.
 * Padded rather than range-shifted so every code is exactly OTP_LENGTH digits:
 * generating in [100000, 999999] to avoid the padding would quietly drop a
 * tenth of the keyspace and make a leading zero impossible, which is the kind
 * of detail an attacker enumerates and we would not.
 */
export function generateCode(): string {
  const ceiling = 10 ** OTP_LENGTH;
  return String(randomInt(0, ceiling)).padStart(OTP_LENGTH, '0');
}

const DIGITS_ONLY = /^\d+$/;

/**
 * Shape check only — never a substitute for comparing against the hash.
 *
 * Length and pattern separately, rather than one interpolated `\d{N}` regex.
 * That regex has to be built from a template literal to reach OTP_LENGTH, and a
 * template literal eats the backslash: `\d` becomes a literal `d`, so the
 * pattern silently matches "dddddd" and nothing else. It fails closed, which is
 * why it is worth writing down — it looked right and rejected every real code.
 */
export function looksLikeCode(input: string): boolean {
  return input.length === OTP_LENGTH && DIGITS_ONLY.test(input);
}

/**
 * May another code go out for this challenge right now?
 *
 * `existing` is null for the first send of a signup, which is always allowed.
 */
export function canSend(existing: OtpChallenge | null, now: number): SendDecision {
  if (!existing) return { ok: true };

  // An expired challenge is a clean slate: the caller replaces it wholesale, so
  // neither the old send count nor the old cooldown carries over. Otherwise
  // someone who let a code lapse an hour ago would be told to wait.
  if (now >= existing.expiresAt) return { ok: true };

  if (existing.sends >= OTP_MAX_SENDS) {
    return { ok: false, reason: 'too_many_sends', retryAfterMs: existing.expiresAt - now };
  }
  const readyAt = existing.lastSentAt + OTP_RESEND_COOLDOWN_MS;
  if (now < readyAt) {
    return { ok: false, reason: 'cooldown', retryAfterMs: readyAt - now };
  }
  return { ok: true };
}

/**
 * Is this challenge still in a state where a guess may be checked?
 *
 * Answers only that. Whether the guess is *correct* is a hash comparison the
 * caller does, because it is async and this module is pure.
 */
export function canAttempt(existing: OtpChallenge, now: number): VerifyDecision {
  if (now >= existing.expiresAt) return { ok: false, reason: 'expired' };
  if (existing.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };
  return { ok: true };
}

/** When a challenge created now would lapse. */
export function expiryFrom(now: number): number {
  return now + OTP_TTL_MS;
}

/** When the next resend becomes available, for telling the client honestly. */
export function resendAvailableAt(lastSentAt: number): number {
  return lastSentAt + OTP_RESEND_COOLDOWN_MS;
}
