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
   * Platform role. ABSENT MEANS PLAYER — the same reasoning as `emailVerified`:
   * every account predates this field, and a `default` would only apply on
   * create, so the read has to handle undefined regardless.
   *
   * `ops` is what `requireAdmin` demands, and this document is the ONLY place it
   * can be granted. There is deliberately no HTTP route that writes it: an
   * endpoint that promotes an account to administrator is the single most
   * valuable thing on the platform to compromise. Use `scripts/grant-ops.ts`,
   * which requires shell access to the server.
   */
  role?: 'player' | 'league_admin' | 'ops';
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
    // No `default: 'player'`, for the reason given on `emailVerified` above:
    // it would apply on create only, so undefined must be handled anyway.
    role: { type: String, enum: ['player', 'league_admin', 'ops'] },
    suspendedAt: { type: Date },
    suspendedReason: { type: String },
    suspendedBy: { type: String },
  },
  { timestamps: true, versionKey: false, collection: 'users' },
);

export const UserModel: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) ?? mongoose.model<UserDoc>('User', userSchema);
