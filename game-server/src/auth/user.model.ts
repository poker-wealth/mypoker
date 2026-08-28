import { randomUUID } from 'node:crypto';
import mongoose, { Schema, type HydratedDocument, type Model } from 'mongoose';

/**
 * The user account store — the gateway owns identity (§: financial-core is
 * money-only and only verifies JWTs). One document per player: email/phone +
 * password, or a linked Google account. The `_id` is the playerId used
 * everywhere else, so a token minted here scopes financial-core queries directly.
 */
export interface UserDoc {
  /** The player's unique ID, formatted as `player-<uuid>`. */
  _id: string;
  email?: string;
  phone?: string;
  /** bcrypt hash; absent for OAuth-only accounts. */
  passwordHash?: string;
  googleId?: string;
  /**
   * Whether the address on this document has been confirmed by email OTP.
   *
   * OPTIONAL ON PURPOSE, and read only through `isSignInAllowed` in
   * `sign-in-rules.ts`: only an explicit `false` blocks a sign-in. Every
   * account created before confirmation existed has no field at all, and
   * treating `undefined` as "unconfirmed" would lock out every one of them on
   * deploy — a migration disguised as a default. Google accounts are written
   * `true` explicitly, because Google has already confirmed the address.
   */
  emailVerified?: boolean;
  displayName?: string;
  photoUrl?: string;
  /**
   * Platform authority. `'ops'` is a platform administrator (the admin panel);
   * absent means a normal player. Deliberately narrow — this is the ONLY thing
   * that lifts an account into the withdrawal queue and treasury, so there is no
   * `'ops' | 'league_admin' | …` here until each of those is actually built.
   */
  role?: 'ops';
  /**
   * Set when an administrator suspends the account; absent means active.
   *
   * A TIMESTAMP RATHER THAN A BOOLEAN, so "when" is answerable without a
   * separate audit lookup — the first question asked about a locked-out player
   * is when it happened.
   */
  suspendedAt?: Date;
  /** Shown to the player at sign-in, so a suspension is never silent. */
  suspendedReason?: string;
  /** The playerId of the administrator who suspended. Never the request body. */
  suspendedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type UserHydrated = HydratedDocument<UserDoc>;

const userSchema = new Schema<UserDoc>(
  {
    _id: { type: String, default: (): string => `player-${randomUUID()}` },
    email: { type: String, unique: true, sparse: true, index: true },
    phone: { type: String, unique: true, sparse: true, index: true },
    passwordHash: { type: String },
    googleId: { type: String, unique: true, sparse: true, index: true },
    // No `default` — see the interface. A default would be applied on create
    // only, leaving existing documents undefined anyway, so the rule that reads
    // this has to handle undefined regardless; better that it is the single
    // place the question is answered.
    emailVerified: { type: Boolean },
    displayName: { type: String },
    photoUrl: { type: String },
    role: { type: String, enum: ['ops'], index: true },
    suspendedAt: { type: Date },
    suspendedReason: { type: String },
    suspendedBy: { type: String },
  },
  { timestamps: true, versionKey: false, collection: 'users' },
);

export const UserModel: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) ?? mongoose.model<UserDoc>('User', userSchema);
