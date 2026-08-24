import * as bcrypt from 'bcrypt';
import { UserModel, type UserDoc } from './user.model';

/**
 * Identity store for the gateway's web sign-in (email/phone + Google).
 *
 * Moved out of financial-core so the money core holds no accounts and no
 * passwords — it only verifies the JWT the gateway signs. The `userStore` object
 * exposes exactly the shape `gateway/auth.ts` consumes (`signup` / `verifyPassword`
 * / `oauth`), each returning `{ playerId, email, displayName, photoUrl }`.
 */

const SALT_ROUNDS = 10;

async function findByIdentifier(identifier: string): Promise<UserDoc | null> {
  const clean = identifier.trim();
  return UserModel.findOne({
    $or: [{ email: clean.toLowerCase() }, { phone: clean }, { email: clean }],
  }).lean();
}

async function createWithPassword(
  identifier: string,
  passwordPlain: string,
  displayName?: string,
): Promise<UserDoc> {
  const clean = identifier.trim();
  if (await findByIdentifier(clean)) {
    throw new Error('User with this email or phone number already exists');
  }
  const passwordHash = await bcrypt.hash(passwordPlain, SALT_ROUNDS);
  const isEmail = clean.includes('@');
  const user = await UserModel.create({
    ...(isEmail ? { email: clean.toLowerCase() } : { phone: clean }),
    passwordHash,
    displayName: displayName || (isEmail ? (clean.split('@')[0] ?? clean) : `User-${clean.slice(-4)}`),
  });
  return user.toObject();
}

async function verifyCredentials(identifier: string, passwordPlain: string): Promise<UserDoc | null> {
  const user = await findByIdentifier(identifier);
  if (!user || !user.passwordHash) return null;
  return (await bcrypt.compare(passwordPlain, user.passwordHash)) ? user : null;
}

async function findOrCreateGoogle(
  googleId: string,
  email: string,
  emailVerified: boolean,
  displayName?: string,
  photoUrl?: string,
): Promise<UserDoc> {
  const existingGoogle = await UserModel.findOne({ googleId }).lean();
  if (existingGoogle) return existingGoogle;

  const existingEmail = await findByIdentifier(email);
  if (existingEmail) {
    // Bonding a Google identity to an ALREADY-REGISTERED account hands whoever
    // holds that Google token everything the account owns — balance and
    // registered withdrawal address included — not just a login. The only
    // thing standing between "any Google account claiming this address" and
    // "the real owner of the mailbox" is Google's own `email_verified` flag,
    // so adoption is refused unless it is true. Creating a brand-new account
    // below is deliberately NOT gated the same way: an unlinked account with
    // an unverified email can't take anything from anyone, so there is no
    // takeover to prevent there.
    if (!emailVerified) {
      throw new Error(
        'This email is registered. Sign in with your password, or verify your email with Google first.',
      );
    }
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
    displayName: displayName || (email.split('@')[0] ?? email),
    ...(photoUrl ? { photoUrl } : {}),
  });
  return user.toObject();
}

export interface StoredIdentity {
  playerId: string;
  email?: string;
  displayName?: string;
  photoUrl?: string | null;
}

const toIdentity = (u: UserDoc): StoredIdentity => {
  const email = u.email || u.phone;
  return {
    playerId: u._id,
    ...(email ? { email } : {}),
    ...(u.displayName ? { displayName: u.displayName } : {}),
    photoUrl: u.photoUrl ?? null,
  };
};

/** Same surface the gateway used to call over HTTP — now local. */
export const userStore = {
  async signup(identifier: string, password: string, displayName?: string): Promise<StoredIdentity> {
    return toIdentity(await createWithPassword(identifier, password, displayName));
  },
  async verifyPassword(identifier: string, password: string): Promise<StoredIdentity> {
    const user = await verifyCredentials(identifier, password);
    if (!user) throw new Error('invalid email or password');
    return toIdentity(user);
  },
  async oauth(
    googleId: string,
    email: string,
    emailVerified: boolean,
    displayName?: string,
    photoUrl?: string,
  ): Promise<StoredIdentity> {
    return toIdentity(await findOrCreateGoogle(googleId, email, emailVerified, displayName, photoUrl));
  },

  /**
   * Admin player search — by display name, email, phone, or playerId.
   *
   * Takes a compiled RegExp rather than a raw string, so escaping is the
   * caller's decision and visible at the call site. Passing user input
   * straight into `$regex` is the classic way an admin search becomes a way
   * to hang the database.
   *
   * Only web sign-ups appear here. Telegram players have no document at all —
   * their playerId is derived from the Telegram user id and nothing is written
   * — so they are reachable by exact id only, which the admin route says out
   * loud rather than returning a silently short list.
   */
  async search(pattern: RegExp, limit: number): Promise<(StoredIdentity & { createdAt: string })[]> {
    const docs = await UserModel.find({
      $or: [
        { displayName: pattern },
        { email: pattern },
        { phone: pattern },
        { _id: pattern },
      ],
    })
      .limit(limit)
      .lean();

    return docs.map((d) => ({
      ...toIdentity(d as UserDoc),
      createdAt: d.createdAt.toISOString(),
    }));
  },

  /** One identity by playerId, or null for a Telegram player (who has none). */
  async byPlayerId(playerId: string): Promise<(StoredIdentity & { createdAt: string }) | null> {
    const doc = await UserModel.findById(playerId).lean();
    if (!doc) return null;
    return { ...toIdentity(doc as UserDoc), createdAt: doc.createdAt.toISOString() };
  },
};
