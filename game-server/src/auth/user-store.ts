import * as bcrypt from 'bcrypt';
import { UserModel, type UserDoc } from './user.model';
import { isSignInAllowed } from './sign-in-rules';

/**
 * Identity store for the gateway's web sign-in (email/phone + Google).
 *
 * Moved out of financial-core so the money core holds no accounts and no
 * passwords — it only verifies the JWT the gateway signs. The `userStore` object
 * exposes exactly the shape `gateway/auth.ts` consumes (`startSignup` /
 * `verifyPassword` / `markEmailVerified` / `oauth`), each returning
 * `{ playerId, email, displayName, photoUrl }`.
 *
 * Email sign-up is a TWO-STEP now: `startSignup` writes an unconfirmed account
 * and mints nothing, and only `markEmailVerified` — reached by proving control
 * of the address with a code — makes it signable-in. `verifyPassword` refuses
 * an account still marked unconfirmed, which is what keeps the second step from
 * being optional.
 */

const SALT_ROUNDS = 10;

async function findByIdentifier(identifier: string): Promise<UserDoc | null> {
  const clean = identifier.trim();
  return UserModel.findOne({
    $or: [{ email: clean.toLowerCase() }, { phone: clean }, { email: clean }],
  }).lean();
}

/**
 * Create the account a confirmation code will be sent for, or reclaim one.
 *
 * RE-REGISTERING OVER AN UNCONFIRMED ACCOUNT IS ALLOWED, and has to be. The
 * document is written before the code is sent, so a signup whose email never
 * arrived — wrong address, full inbox, SMTP down — leaves a row holding that
 * address forever. Refusing on it would tell the real owner "this email is
 * already taken" by an account nobody has ever proved they own, with no way
 * through. Overwriting the password is safe for exactly the same reason: nobody
 * has demonstrated control of the address yet, so there is no session, no
 * balance and nothing to take over. A CONFIRMED account is never overwritten.
 *
 * Email only. A phone signup would create an account no code can ever confirm —
 * there is no SMS provider — so the gateway rejects one before reaching here;
 * this asserts it rather than trusting that.
 */
async function createUnverifiedWithPassword(
  identifier: string,
  passwordPlain: string,
  displayName?: string,
): Promise<UserDoc> {
  const clean = identifier.trim();
  if (!clean.includes('@')) {
    throw new Error('a valid email address is required');
  }
  const email = clean.toLowerCase();
  const passwordHash = await bcrypt.hash(passwordPlain, SALT_ROUNDS);
  const name = displayName || (clean.split('@')[0] ?? clean);

  const existing = await findByIdentifier(clean);
  if (existing) {
    if (isSignInAllowed(existing).ok) {
      throw new Error('User with this email or phone number already exists');
    }
    const updated = await UserModel.findOneAndUpdate(
      { _id: existing._id },
      { $set: { passwordHash, displayName: name, emailVerified: false } },
      { new: true },
    ).lean();
    return updated!;
  }

  const user = await UserModel.create({
    email,
    passwordHash,
    displayName: name,
    emailVerified: false,
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
  displayName?: string,
  photoUrl?: string,
): Promise<UserDoc> {
  const existingGoogle = await UserModel.findOne({ googleId }).lean();
  if (existingGoogle) return existingGoogle;

  const existingEmail = await findByIdentifier(email);
  if (existingEmail) {
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
    // Google has already confirmed the address — that is what an OAuth sign-in
    // is. Written explicitly rather than left absent so the state is a fact on
    // the document, not an inference from a missing field.
    emailVerified: true,
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

/**
 * The result of checking a password.
 *
 * A RESULT, NOT A THROW, because there are now two distinct failures and the
 * route has to tell them apart: wrong credentials get a flat 401, an
 * unconfirmed address gets a 403 that sends the client to the code screen.
 * Distinguishing those by matching on an Error's message string is how a
 * reworded message silently turns a "confirm your email" into "wrong password".
 *
 * `identity` accompanies `email_unverified` and only that: the caller has just
 * proved it knows the password, so it already knows whose account this is, and
 * the resend path needs the playerId. It is deliberately ABSENT from
 * `invalid_credentials`, where nothing has been proved.
 */
export type PasswordCheck =
  | { ok: true; identity: StoredIdentity }
  | { ok: false; reason: 'invalid_credentials' }
  | { ok: false; reason: 'email_unverified'; identity: StoredIdentity };

/** Same surface the gateway used to call over HTTP — now local. */
export const userStore = {
  /**
   * Write the unconfirmed account a code will be sent for. Mints no session.
   *
   * Throws only when the address belongs to a CONFIRMED account; an unconfirmed
   * one is reclaimed. See `createUnverifiedWithPassword`.
   */
  async startSignup(identifier: string, password: string, displayName?: string): Promise<StoredIdentity> {
    return toIdentity(await createUnverifiedWithPassword(identifier, password, displayName));
  },

  async verifyPassword(identifier: string, password: string): Promise<PasswordCheck> {
    const user = await verifyCredentials(identifier, password);
    if (!user) return { ok: false, reason: 'invalid_credentials' };

    // Password first, confirmation second — never the other way round. Checking
    // confirmation before the password would answer "is this address
    // registered and unconfirmed?" to anyone who typed it, which is an account
    // enumeration oracle with a free hint attached.
    const verdict = isSignInAllowed(user);
    if (!verdict.ok) return { ok: false, reason: verdict.reason, identity: toIdentity(user) };

    return { ok: true, identity: toIdentity(user) };
  },

  /**
   * Mark an address confirmed. Called only after a correct code.
   *
   * Keyed on playerId taken from the CHALLENGE, not from anything the client
   * sent, so a correct code can only ever confirm the account it was issued for.
   */
  async markEmailVerified(playerId: string): Promise<StoredIdentity | null> {
    const updated = await UserModel.findOneAndUpdate(
      { _id: playerId },
      { $set: { emailVerified: true } },
      { new: true },
    ).lean();
    return updated ? toIdentity(updated as UserDoc) : null;
  },

  async oauth(
    googleId: string,
    email: string,
    displayName?: string,
    photoUrl?: string,
  ): Promise<StoredIdentity> {
    return toIdentity(await findOrCreateGoogle(googleId, email, displayName, photoUrl));
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
