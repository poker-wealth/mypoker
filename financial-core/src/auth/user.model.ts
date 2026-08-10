import { randomUUID } from 'node:crypto';
import mongoose, { Schema, type HydratedDocument, type Model } from 'mongoose';

export interface UserDoc {
  /** The player's unique ID, formatted as `player-<uuid>` */
  _id: string;
  email?: string;
  phone?: string;
  /** Hashed password using bcrypt. Null if registered via OAuth */
  passwordHash?: string;
  googleId?: string;
  displayName?: string;
  photoUrl?: string;
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
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'users',
  }
);

export const UserModel: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) ??
  mongoose.model<UserDoc>('User', userSchema);
