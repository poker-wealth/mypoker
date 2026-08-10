import * as bcrypt from 'bcrypt';
import { UserModel, type UserDoc } from './user.model';

const SALT_ROUNDS = 10;

export async function findUserByIdentifier(identifier: string): Promise<UserDoc | null> {
  const clean = identifier.trim();
  return UserModel.findOne({
    $or: [{ email: clean.toLowerCase() }, { phone: clean }, { email: clean }],
  }).lean();
}

export async function findUserByEmail(email: string): Promise<UserDoc | null> {
  return findUserByIdentifier(email);
}

export async function findUserByGoogleId(googleId: string): Promise<UserDoc | null> {
  return UserModel.findOne({ googleId }).lean();
}

export async function createUserWithPassword(
  identifier: string,
  passwordPlain: string,
  displayName?: string,
): Promise<UserDoc> {
  const clean = identifier.trim();
  const existing = await findUserByIdentifier(clean);
  if (existing) {
    throw new Error('User with this email or phone number already exists');
  }

  const passwordHash = await bcrypt.hash(passwordPlain, SALT_ROUNDS);
  const isEmail = clean.includes('@');
  
  const user = await UserModel.create({
    ...(isEmail ? { email: clean.toLowerCase() } : { phone: clean }),
    passwordHash,
    displayName: displayName || (isEmail ? clean.split('@')[0] : `User-${clean.slice(-4)}`),
  });
  
  return user.toObject();
}

export async function verifyPassword(identifier: string, passwordPlain: string): Promise<UserDoc | null> {
  const user = await findUserByIdentifier(identifier);
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
