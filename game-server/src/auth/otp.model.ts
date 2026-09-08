import mongoose, { Schema, type Model } from 'mongoose';

/**
 * A pending email-confirmation challenge.
 *
 * Keyed by the identifier, so an address has at most one live challenge and a
 * resend replaces rather than accumulates. Two concurrent signups for the same
 * address therefore cannot leave two valid codes in flight — the second
 * overwrites the first, and only the code actually delivered last works.
 *
 * The CODE IS NEVER STORED, only a bcrypt hash of it. Six digits is a million
 * possibilities: with a fast hash, anyone who reads this collection reads every
 * live code. bcrypt is already a dependency here (passwords) and makes the same
 * dump worth days rather than milliseconds.
 */
export interface EmailOtpDoc {
  /** The identifier being confirmed — lowercased email. */
  _id: string;
  /** bcrypt hash of the code. Never the code. */
  codeHash: string;
  /** The playerId the code confirms, so verification cannot be redirected. */
  playerId: string;
  /** Wrong guesses so far. */
  attempts: number;
  /** Codes sent for this challenge, including the first. */
  sends: number;
  lastSentAt: Date;
  expiresAt: Date;
  pendingPasswordHash?: string;
  pendingDisplayName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const otpSchema = new Schema<EmailOtpDoc>(
  {
    _id: { type: String, required: true },
    codeHash: { type: String, required: true },
    playerId: { type: String, required: true },
    attempts: { type: Number, required: true, default: 0 },
    sends: { type: Number, required: true, default: 1 },
    lastSentAt: { type: Date, required: true },
    // A TTL index so lapsed challenges do not accumulate forever. It is
    // housekeeping ONLY — Mongo's reaper runs about once a minute, so an
    // expired document is readable for a while after it lapses. Expiry is
    // enforced in the rules against `expiresAt`, never by the absence of a row.
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    // Credentials bound to THIS challenge — see `OtpChallenge.pending`. The
    // hash only; a challenge row is not a place for a plaintext password.
    pendingPasswordHash: { type: String },
    pendingDisplayName: { type: String },
  },
  { timestamps: true, versionKey: false, collection: 'email_otps' },
);

export const EmailOtpModel: Model<EmailOtpDoc> =
  (mongoose.models.EmailOtp as Model<EmailOtpDoc>) ??
  mongoose.model<EmailOtpDoc>('EmailOtp', otpSchema);
