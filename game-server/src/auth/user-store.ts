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
    const user = await verifyCredentials(identifier, password);
    if (!user) throw new Error('invalid email or password');
    return toIdentity(user);
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
