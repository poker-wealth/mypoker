import * as bcrypt from 'bcrypt';
import { EmailOtpModel } from './otp.model';
import {
  canAttempt,
  canSend,
  expiryFrom,
  generateCode,
  looksLikeCode,
  resendAvailableAt,
  type OtpChallenge,
} from './otp-rules';

/**
 * Storage for email-confirmation challenges.
 *
 * Deliberately thin: every decision lives in `otp-rules.ts`, which has no
 * database and no clock, so the rules are testable on their own. What is left
 * here is reading a row, hashing, and writing a row.
 *
 * PERSISTENCE IS THE ONLY INJECTABLE PART. `createOtpStore` takes a four-method
 * port and nothing else, so a test runs this exact code — the same hashing, the
 * same rule calls, the same consume-on-success — with a Map behind it. The
 * alternative, a second in-memory implementation of the same logic written for
 * the test, proves that the copy works. docs/TRAPS.md #1 is a list of what that
 * costs.
 */

/** Cheaper than the password rounds on purpose — see `issue`. */
const OTP_SALT_ROUNDS = 8;

/** One stored challenge, in plain values. Dates are epoch milliseconds. */
export interface StoredOtp extends OtpChallenge {
  playerId: string;
}

/** The four things this store needs a database for. */
export interface OtpPersistence {
  get(key: string): Promise<StoredOtp | null>;
  /** Create or replace wholesale. */
  put(key: string, value: StoredOtp): Promise<void>;
  /** Atomic — two wrong guesses racing must cost two attempts, not one. */
  incrementAttempts(key: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface IssuedOtp {
  /** The plaintext code. Returned ONCE, to be mailed, and never stored. */
  code: string;
  expiresAt: number;
  resendAvailableAt: number;
  /** How many codes have now gone out for this challenge, including this one. */
  sends: number;
}

export type IssueResult =
  | { ok: true; issued: IssuedOtp }
  | { ok: false; reason: 'cooldown' | 'too_many_sends'; retryAfterMs: number };

export type VerifyResult =
  | { ok: true; playerId: string }
  | { ok: false; reason: 'no_challenge' | 'expired' | 'too_many_attempts' | 'incorrect' };

export interface OtpStore {
  issue(identifier: string, playerId: string, now?: number): Promise<IssueResult>;
  verify(identifier: string, code: string, now?: number): Promise<VerifyResult>;
  peek(identifier: string): Promise<{ playerId: string; expiresAt: number } | null>;
  discard(identifier: string): Promise<void>;
}

/** Lowercased and trimmed everywhere, so one address is one challenge. */
const keyFor = (identifier: string): string => identifier.trim().toLowerCase();

export function createOtpStore(persistence: OtpPersistence): OtpStore {
  return {
    /**
     * Mint a code for `identifier`, or refuse and say when to come back.
     *
     * A resend REPLACES the challenge: new code, new expiry, attempts back to
     * zero. Carrying the old attempt count over would let anyone burn a
     * stranger's five guesses and leave the real owner locked out holding a
     * code that no longer works — the cap exists to stop guessing, not to
     * punish the addressee. The send ceiling in `otp-rules` is what stops the
     * reset being a free retry machine: five codes per challenge, one a minute.
     */
    async issue(identifier: string, playerId: string, now: number = Date.now()): Promise<IssueResult> {
      const key = keyFor(identifier);
      const existing = await persistence.get(key);

      const decision = canSend(existing, now);
      if (!decision.ok) {
        return { ok: false, reason: decision.reason, retryAfterMs: decision.retryAfterMs };
      }

      // A live challenge continues its send count; an absent or lapsed one
      // starts over. `canSend` has already agreed that a lapsed challenge is a
      // clean slate, so the two must read expiry the same way — hence the same
      // comparison here, not a second derivation of it.
      const continuing = existing !== null && now < existing.expiresAt;
      const sends = continuing ? existing.sends + 1 : 1;

      const code = generateCode();
      // Eight rounds, not the ten used for passwords. A code lives ten minutes,
      // survives five guesses and is then gone; a password hash sits in the
      // database for years. The work factor is sized to the lifetime of what it
      // protects, and this one is on the signup request path.
      const codeHash = await bcrypt.hash(code, OTP_SALT_ROUNDS);
      const expiresAt = expiryFrom(now);

      await persistence.put(key, {
        codeHash,
        playerId,
        attempts: 0,
        sends,
        lastSentAt: now,
        expiresAt,
      });

      return {
        ok: true,
        issued: { code, expiresAt, resendAvailableAt: resendAvailableAt(now), sends },
      };
    },

    /**
     * Check a guess and, if it is right, consume the challenge.
     *
     * The challenge is DELETED on success, before the caller does anything with
     * the result. A code that has been spent must not be spendable again: two
     * requests racing the same correct code would otherwise both succeed, and
     * while that happens to be harmless today — both confirm the same account —
     * it stops being harmless the first time confirmation grants anything.
     *
     * A wrong guess costs an attempt whether or not it was even the right
     * shape. Free malformed guesses would be a way to hold a challenge open
     * indefinitely while probing something else.
     */
    async verify(identifier: string, code: string, now: number = Date.now()): Promise<VerifyResult> {
      const key = keyFor(identifier);
      const existing = await persistence.get(key);
      if (!existing) return { ok: false, reason: 'no_challenge' };

      const state = canAttempt(existing, now);
      if (!state.ok) return { ok: false, reason: state.reason };

      const matches = looksLikeCode(code) && (await bcrypt.compare(code, existing.codeHash));
      if (!matches) {
        await persistence.incrementAttempts(key);
        return { ok: false, reason: 'incorrect' };
      }

      await persistence.delete(key);
      return { ok: true, playerId: existing.playerId };
    },

    /** The live challenge for an address, or null. Resend must not mint one blindly. */
    async peek(identifier: string): Promise<{ playerId: string; expiresAt: number } | null> {
      const existing = await persistence.get(keyFor(identifier));
      if (!existing) return null;
      return { playerId: existing.playerId, expiresAt: existing.expiresAt };
    },

    /**
     * Throw a challenge away because its code never reached anybody.
     *
     * `issue` writes the challenge before the mail is attempted, which starts
     * the sixty-second resend cooldown. If the send then fails outright, that
     * cooldown is charged against a code the player never received: they are
     * refused, told to wait a minute, and the wait buys them nothing. Removing
     * the challenge puts them back where they started.
     *
     * Nothing is lost by this. Any earlier code was already invalidated by the
     * `issue` that replaced it, and a failed send means no mail is going out,
     * so lifting the cooldown cannot become a way to flood an inbox.
     */
    async discard(identifier: string): Promise<void> {
      await persistence.delete(keyFor(identifier));
    },
  };
}

/** The Mongo-backed port. Reading and writing only; no decisions. */
export const mongoOtpPersistence: OtpPersistence = {
  async get(key) {
    const doc = await EmailOtpModel.findById(key).lean();
    if (!doc) return null;
    return {
      codeHash: doc.codeHash,
      playerId: doc.playerId,
      attempts: doc.attempts,
      sends: doc.sends,
      lastSentAt: doc.lastSentAt.getTime(),
      expiresAt: doc.expiresAt.getTime(),
    };
  },
  async put(key, value) {
    await EmailOtpModel.findByIdAndUpdate(
      key,
      {
        $set: {
          codeHash: value.codeHash,
          playerId: value.playerId,
          attempts: value.attempts,
          sends: value.sends,
          lastSentAt: new Date(value.lastSentAt),
          expiresAt: new Date(value.expiresAt),
        },
      },
      { upsert: true },
    );
  },
  async incrementAttempts(key) {
    await EmailOtpModel.updateOne({ _id: key }, { $inc: { attempts: 1 } });
  },
  async delete(key) {
    await EmailOtpModel.deleteOne({ _id: key });
  },
};

/** The one the gateway uses. */
export const otpStore: OtpStore = createOtpStore(mongoOtpPersistence);
