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
  displayName?: string;
  photoUrl?: string;
  /**
   * Platform authority. `'ops'` is a platform administrator (the admin panel);
   * absent means a normal player. Deliberately narrow — this is the ONLY thing
   * that lifts an account into the withdrawal queue and treasury, so there is no
   * `'ops' | 'league_admin' | …` here until each of those is actually built.
   */
  role?: 'ops';
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
    displayName: { type: String },
    photoUrl: { type: String },
    role: { type: String, enum: ['ops'], index: true },
  },
  { timestamps: true, versionKey: false, collection: 'users' },
);

export const UserModel: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) ?? mongoose.model<UserDoc>('User', userSchema);
