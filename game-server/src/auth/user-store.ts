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

/**
 * Why a signup was refused. Same closed-set discipline as `LoginRefusal`.
 *
 * WHAT THIS DOES NOT FIX, stated plainly so nobody reads the codes and assumes
 * the door is shut: /auth/signup still confirms that an identifier is taken,
 * because refusing a duplicate account IS that confirmation. There is no
 * wording that both refuses the request and withholds the reason. Login no
 * longer distinguishes; signup structurally cannot be made not to.
 *
 * Closing it needs the request to stop being answered synchronously at all —
 * accept the signup, send a verification mail, and let the mailbox owner learn
 * whether the address was already registered. That machinery is being built in
 * the email-OTP work, not here. This change does not widen the door; it brings
 * it into the same shape so the two are comparable.
 *
 * `use_google` is answered here for the same account state that answers
 * `use_google` at login, so probing one endpoint tells you nothing the other
 * would not.
 */
export type SignupRefusal = 'account_exists' | 'use_google';

export class SignupError extends Error {
  constructor(
    readonly code: SignupRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'SignupError';
  }
}

const SIGNUP_REFUSAL_TEXT: Readonly<Record<SignupRefusal, string>> = {
  account_exists: 'An account with this email or phone number already exists',
  use_google: 'This account was created with Google — use “Continue with Google”',
};

async function createWithPassword(
  identifier: string,
  passwordPlain: string,
  displayName?: string,
): Promise<UserDoc> {
  const clean = identifier.trim();
  const existing = await findByIdentifier(clean);
  if (existing) {
    // A Google account gets the same answer signing up as it gets signing in,
    // rather than "already exists" — otherwise the two endpoints disagree about
    // one account state, and the disagreement is itself the information.
    const code: SignupRefusal = existing.passwordHash ? 'account_exists' : 'use_google';
    throw new SignupError(code, SIGNUP_REFUSAL_TEXT[code]);
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

/**
 * Why a sign-in was refused.
 *
 * READ THIS BEFORE WIDENING IT.
 *
 * An earlier revision split this into `no_account` and `wrong_password` so a
 * user who mistypes knows which field to fix. That is a genuinely nicer form,
 * and it is an ACCOUNT ENUMERATION ORACLE: anyone can feed in a list of email
 * addresses and learn which are registered here, then aim every subsequent
 * password attempt at accounts they know exist. On a platform holding money
 * that list has value by itself. The two are now one answer, so /auth/login
 * confirms nothing about who banks here.
 *
 * Two rules follow, and neither is optional:
 *
 *   1. Do not re-split this. "Which field was wrong" cannot be told to an
 *      unauthenticated caller without handing back the oracle. If the UX is
 *      wanted, it belongs AFTER a verified session, never at the door.
 *   2. The reasons stay a CLOSED set of codes, never free text built from a
 *      document. A message assembled from what was found in the database is one
 *      refactor away from putting the display name or the email of an account
 *      the caller does not own into the response.
 *
 * `use_google` is the one deliberate exception and it is narrower than it
 * looks: it fires only for an account with no password hash at all, so it
 * distinguishes Google accounts, not accounts-in-general. It stays because
 * folding it into the generic answer sends a Google user round a loop they
 * cannot escape — every password on earth is "wrong" for an account that has
 * none, so "check your typing" is advice that can never come true. Signup
 * answers `use_google` for the same account state, so the two doors agree.
 */
export type LoginRefusal = 'invalid_credentials' | 'use_google';

export class LoginError extends Error {
  constructor(readonly code: LoginRefusal, message: string) {
    super(message);
    this.name = 'LoginError';
  }
}

/** English fallback for each refusal. The client translates from the code. */
const REFUSAL_TEXT: Readonly<Record<LoginRefusal, string>> = {
  invalid_credentials: 'Incorrect email, phone number or password',
  use_google: 'This account was created with Google — use “Continue with Google”',
};

/**
 * A real bcrypt hash, of a value no caller can submit, compared against when
 * the account does not exist.
 *
 * Merging the two refusal codes is only half of closing the oracle. A missing
 * account skips bcrypt entirely and answers in microseconds; a wrong password
 * spends the full cost of a 10-round hash. That difference is measurable over
 * a handful of requests, and it rebuilds from response time alone exactly the
 * distinction the merged code just removed. So the absent case does the same
 * work as the present one and the two are indistinguishable from outside.
 */
const ABSENT_ACCOUNT_HASH = '$2b$10$NrXUDLZ779ib2eUHE/JBqOST9VNyWgfanq/gcOYVxo/rB4T5NWY/G';

/**
 * Resolve a sign-in attempt to a user, or to the reason it failed.
 *
 * Every failure that is about the credentials answers `invalid_credentials`,
 * whether or not the account exists — see the note on `LoginRefusal`.
 */
async function verifyCredentials(
  identifier: string,
  passwordPlain: string,
): Promise<{ ok: true; user: UserDoc } | { ok: false; code: LoginRefusal }> {
  const user = await findByIdentifier(identifier);
  if (!user) {
    // Deliberately not short-circuited. See ABSENT_ACCOUNT_HASH.
    await bcrypt.compare(passwordPlain, ABSENT_ACCOUNT_HASH);
    return { ok: false, code: 'invalid_credentials' };
  }
  if (!user.passwordHash) return { ok: false, code: 'use_google' };
  const matches = await bcrypt.compare(passwordPlain, user.passwordHash);
  return matches ? { ok: true, user } : { ok: false, code: 'invalid_credentials' };
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
    ...(photoUrl ? { photoUrl } : {}),
  });
  return user.toObject();
}

export interface StoredIdentity {
  playerId: string;
  email?: string;
  displayName?: string;
  photoUrl?: string | null;
  /** Present only for platform administrators; absent = a normal player. */
  role?: 'ops';
}

const toIdentity = (u: UserDoc): StoredIdentity => {
  const email = u.email || u.phone;
  return {
    playerId: u._id,
    ...(email ? { email } : {}),
    ...(u.displayName ? { displayName: u.displayName } : {}),
    photoUrl: u.photoUrl ?? null,
    ...(u.role ? { role: u.role } : {}),
  };
};

/** Same surface the gateway used to call over HTTP — now local. */
export const userStore = {
  async signup(identifier: string, password: string, displayName?: string): Promise<StoredIdentity> {
    return toIdentity(await createWithPassword(identifier, password, displayName));
  },
  async verifyPassword(identifier: string, password: string): Promise<StoredIdentity> {
    const result = await verifyCredentials(identifier, password);
    if (!result.ok) {
      // English here is the fallback only. The client translates from `code`
      // (see mobile/src/auth.tsx) — a server that speaks one language cannot be
      // the source of a user-facing string in an app that ships eight.
      throw new LoginError(result.code, REFUSAL_TEXT[result.code]);
    }
    return toIdentity(result.user);
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

  /**
   * Identities for many playerIds in ONE query — for enriching the admin Users
   * list. Telegram players simply have no entry in the returned map (they have
   * no identity document), which the caller renders as the playerId.
   */
  async byPlayerIds(playerIds: readonly string[]): Promise<Map<string, StoredIdentity>> {
    if (playerIds.length === 0) return new Map();
    const docs = await UserModel.find({ _id: { $in: [...playerIds] } }).lean();
    return new Map(docs.map((d) => [d._id, toIdentity(d as UserDoc)]));
  },

  /**
   * Create a platform administrator (role: 'ops'). Email + password only — an
   * admin never signs in with Telegram or Google, so `ops` can only be minted
   * through the credential path this creates. Throws on a weak password or a
   * taken email rather than silently making a second, unreachable account.
   */
  async createAdmin(email: string, password: string, displayName?: string): Promise<StoredIdentity> {
    const clean = email.trim().toLowerCase();
    if (!clean.includes('@')) throw new Error('an admin needs an email address');
    if (password.length < 8) throw new Error('admin password must be at least 8 characters');
    if (await findByIdentifier(clean)) throw new Error('an account with this email already exists');
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await UserModel.create({
      email: clean,
      passwordHash,
      displayName: displayName?.trim() || (clean.split('@')[0] ?? clean),
      role: 'ops',
    });
    return toIdentity(user.toObject());
  },

  /** Every administrator, newest first — for the admin panel's Admins screen. */
  async listAdmins(): Promise<(StoredIdentity & { createdAt: string })[]> {
    const docs = await UserModel.find({ role: 'ops' }).sort({ createdAt: -1 }).lean();
    return docs.map((d) => ({ ...toIdentity(d as UserDoc), createdAt: d.createdAt.toISOString() }));
  },
};

/**
 * The built-in default administrator (owner's choice: a hardcoded default that
 * works out of the box). Overridable by env so it can be secured without a code
 * change — set `ADMIN_EMAIL` / `ADMIN_PASSWORD` on the gateway and they win.
 *
 * ⚠️ CHANGE THE PASSWORD after first login: create your real admin on the Admins
 * screen, then this default is just a bootstrap. A known admin password on a
 * live platform that controls withdrawals is exactly the credential to rotate.
 */
export const DEFAULT_ADMIN_EMAIL = (process.env.ADMIN_EMAIL?.trim() || 'admin@mypoker777.com').toLowerCase();
export const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'MyPoker777!Admin';

/**
 * Seed the first administrator on boot. Idempotent and safe to call every start:
 *   - an ops account already exists → do nothing.
 *   - the default email exists as a normal user → promote it to ops.
 *   - otherwise → create it with the default credentials.
 * So the panel is never locked out, and re-deploying never spawns duplicates.
 */
export async function seedDefaultAdmin(): Promise<void> {
  if (await UserModel.exists({ role: 'ops' })) return;

  const existing = await UserModel.findOne({ email: DEFAULT_ADMIN_EMAIL });
  if (existing) {
    await UserModel.updateOne({ _id: existing._id }, { $set: { role: 'ops' } });
    console.log(`[admin] promoted existing account ${DEFAULT_ADMIN_EMAIL} to ops`);
    return;
  }

  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, SALT_ROUNDS);
  await UserModel.create({
    email: DEFAULT_ADMIN_EMAIL,
    passwordHash,
    displayName: 'Administrator',
    role: 'ops',
  });
  console.log(
    `[admin] seeded default administrator ${DEFAULT_ADMIN_EMAIL} — CHANGE THE PASSWORD after first login`,
  );
}
