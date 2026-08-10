import * as bcrypt from 'bcrypt';
import { UserModel, type UserDoc } from './user.model';

const SALT_ROUNDS = 10;

export async function findUserByEmail(email: string): Promise<UserDoc | null> {
  return UserModel.findOne({ email }).lean();
}

export async function findUserByGoogleId(googleId: string): Promise<UserDoc | null> {
  return UserModel.findOne({ googleId }).lean();
}

export async function createUserWithPassword(
  email: string,
  passwordPlain: string,
  displayName?: string,
): Promise<UserDoc> {
  const existing = await findUserByEmail(email);
  if (existing) {
    throw new Error('User with this email already exists');
  }

  const passwordHash = await bcrypt.hash(passwordPlain, SALT_ROUNDS);
  
  const user = await UserModel.create({
    email,
    passwordHash,
    displayName: displayName || email.split('@')[0],
  });
  
  return user.toObject();
}

export async function verifyPassword(email: string, passwordPlain: string): Promise<UserDoc | null> {
  const user = await UserModel.findOne({ email }).lean();
  if (!user || !user.passwordHash) return null;

  const isValid = await bcrypt.compare(passwordPlain, user.passwordHash);
  return isValid ? user : null;
}

export async function findOrCreateGoogleUser(
  googleId: string,
  email: string,
  displayName?: string,
  photoUrl?: string,
): Promise<UserDoc> {
  const existingGoogle = await findUserByGoogleId(googleId);
  if (existingGoogle) return existingGoogle;

  const existingEmail = await findUserByEmail(email);
  if (existingEmail) {
    // If they registered with email previously, just link the Google ID
    const updated = await UserModel.findOneAndUpdate(
      { _id: existingEmail._id },
      { $set: { googleId, photoUrl: photoUrl || existingEmail.photoUrl } },
      { new: true },
    ).lean();
    return updated!;
  }

  const user = await UserModel.create({
    googleId,
    email,
    displayName: displayName || email.split('@')[0],
    photoUrl,
  });

  return user.toObject();
}
