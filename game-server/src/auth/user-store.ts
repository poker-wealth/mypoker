import * as bcrypt from 'bcrypt';
import type { ClientSession } from 'mongoose';
import { UserModel, type UserDoc } from './user.model';
import { isSignInAllowed, isClaimableBySignup } from './sign-in-rules';
import { validateEmailAddress, validatePasswordStrength } from './credential-rules';

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
/**
 * The outcome of starting a signup.
 *
 * `pending` is set ONLY when the address already had an unconfirmed account.
 * In that case nothing about the existing row's credentials is touched, and
 * these are the ones to bind to the challenge — applied when its code is
 * presented, and not before.
 */
interface StartedSignup {
  user: UserDoc;
  pending?: { passwordHash: string; displayName?: string };
}

async function createUnverifiedWithPassword(
  identifier: string,
  passwordPlain: string,
  displayName?: string,
): Promise<StartedSignup> {
  const clean = identifier.trim();
  if (!clean.includes('@')) {
    throw new Error('a valid email address is required');
  }
  const email = clean.toLowerCase();
  const passwordHash = await bcrypt.hash(passwordPlain, SALT_ROUNDS);
  const name = displayName || (clean.split('@')[0] ?? clean);

  const existing = await findByIdentifier(clean);
  if (existing) {
    // WHICH accounts a fresh signup may take over, stated positively.
    //
    // This was `!isSignInAllowed(existing).ok`, which reads as "reclaim the
    // ones that cannot sign in" and is true of a SUSPENDED account as well as
    // an unconfirmed one. So signing up again with a banned address overwrote
    // its password and reset `emailVerified`, leaving `suspendedAt` untouched
    // — and the confirmation door then issued a token. A ban that a signup
    // form lifts is not a ban.
    //
    // Only an unconfirmed, unsuspended account is claimable. Anything else is
    // an account that exists, and says so.
    if (!isClaimableBySignup(existing)) {
      throw new Error('User with this email or phone number already exists');
    }
    // THE ROW IS NOT TOUCHED.
    //
    // This used to $set the new password straight onto the existing account.
    // An unconfirmed account is claimable by anyone who knows the address, so
    // that let a stranger set the password on somebody else's pending signup —
    // and when the real owner confirmed with the code in their own inbox, they
    // handed over an account whose password the stranger knew. The attacker
    // never needed the code; the victim delivered it for them.
    //
    // Instead the credentials ride on the challenge and are applied by
    // `markEmailVerified` when that challenge's code is presented. Binding is
    // per-CHALLENGE and that is the point: `issue` replaces the challenge, so
    // the newest code is the only live one and it carries the credentials typed
    // alongside it. Someone confirming the code they just requested gets the
    // password they just chose.
    return { user: existing, pending: { passwordHash, ...(displayName ? { displayName: name } : {}) } };
  }

  // A FIRST signup on this address writes its password directly. There is no
  // account to take over and nobody to protect it from, and deferring it would
  // leave a row that cannot be signed into if the challenge is never completed.
  const user = await UserModel.create({
    email,
    passwordHash,
    displayName: name,
    emailVerified: false,
  });
  return { user: user.toObject() };
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

/**
 * One account as an administrator sees it.
 *
 * `hasPassword` rather than the hash — an admin has no use for a bcrypt string,
 * and a field that never leaves the database cannot leak through a log, a
 * screenshot or a support ticket. The only question a form needs answered is
 * whether there is a password to replace.
 */
export interface AdminUserRecord {
  playerId: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  photoUrl: string | null;
  emailVerified: boolean | null;
  /**
   * Flattened for the form: the document stores `'ops'` or nothing, and this
   * reports the absent case as `'player'` rather than null. `league_admin` is
   * deliberately not offered — the document's own comment says the enum stays
   * narrow until each authority is actually built, and an admin form listing a
   * role that grants nothing is a control with no effect.
   */
  role: 'player' | 'ops';
  hasPassword: boolean;
  hasGoogle: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  suspendedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The editable fields, and the three-state convention that makes clearing
 * possible: absent = leave alone, `null` = clear, a value = set.
 *
 * `suspendedAt` is deliberately NOT here. Suspension goes through its own method
 * so the acting administrator is recorded with it; a suspension that arrived as
 * a field in a general patch would have no one's name attached.
 */
export interface AdminUserPatch {
  displayName?: string;
  email?: string | null;
  phone?: string | null;
  emailVerified?: boolean;
  role?: 'player' | 'ops';
  photoUrl?: string | null;
}

const toAdminRecord = (u: UserDoc): AdminUserRecord => ({
  playerId: u._id,
  email: u.email ?? null,
  phone: u.phone ?? null,
  displayName: u.displayName ?? null,
  photoUrl: u.photoUrl ?? null,
  // null, not false: an account predating the field has never been asked the
  // question, which is a different fact from having failed to confirm.
  emailVerified: u.emailVerified ?? null,
  role: u.role ?? 'player',
  hasPassword: Boolean(u.passwordHash),
  hasGoogle: Boolean(u.googleId),
  suspendedAt: u.suspendedAt ? u.suspendedAt.toISOString() : null,
  suspendedReason: u.suspendedReason ?? null,
  suspendedBy: u.suspendedBy ?? null,
  createdAt: u.createdAt.toISOString(),
  updatedAt: u.updatedAt.toISOString(),
});

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
/**
 * The outcome of confirming an email address — an identity only when the
 * account may actually sign in. See `markEmailVerified`.
 */
export type EmailVerifyResult =
  | { ok: true; identity: StoredIdentity }
  | { ok: false; reason: 'no_account' }
  | { ok: false; reason: 'suspended'; suspendedReason?: string };

export type PasswordCheck =
  | { ok: true; identity: StoredIdentity }
  | { ok: false; reason: 'invalid_credentials' }
  | { ok: false; reason: 'email_unverified'; identity: StoredIdentity }
  /**
   * Suspended by an administrator. Carries the reason so the route can tell the
   * player WHY — a lockout with no explanation generates a support ticket every
   * time, and the reason was written by an admin for exactly this moment.
   */
  | { ok: false; reason: 'suspended'; suspendedReason?: string };

/**
 * The result of an authenticated password change.
 *
 * `no_password` is its own reason, distinct from `invalid_current_password`:
 * a Google-linked account with no `passwordHash` has nothing to check the
 * supplied "current password" against, and telling them their password was
 * wrong would send them looking for a password they never set. See the class
 * comment on the change-password route in `gateway/auth.ts`.
 */
export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: 'no_account' }
  | { ok: false; reason: 'no_password' }
  | { ok: false; reason: 'invalid_current_password' };

/** Same surface the gateway used to call over HTTP — now local. */
export const userStore = {
  /**
   * Write the unconfirmed account a code will be sent for. Mints no session.
   *
   * Throws only when the address belongs to a CONFIRMED account; an unconfirmed
   * one is reclaimed. See `createUnverifiedWithPassword`.
   */
  async startSignup(
    identifier: string,
    password: string,
    displayName?: string,
  ): Promise<{ identity: StoredIdentity; pending?: { passwordHash: string; displayName?: string } }> {
    const started = await createUnverifiedWithPassword(identifier, password, displayName);
    return {
      identity: toIdentity(started.user),
      ...(started.pending ? { pending: started.pending } : {}),
    };
  },

  async verifyPassword(identifier: string, password: string): Promise<PasswordCheck> {
    const user = await verifyCredentials(identifier, password);
    if (!user) return { ok: false, reason: 'invalid_credentials' };

    // Password first, confirmation second — never the other way round. Checking
    // confirmation before the password would answer "is this address
    // registered and unconfirmed?" to anyone who typed it, which is an account
    // enumeration oracle with a free hint attached.
    const verdict = isSignInAllowed(user);
    if (!verdict.ok) {
      // `identity` accompanies `email_unverified` only — the resend path needs
      // the playerId. A suspended account gets NO identity back: there is no
      // second step to offer, and handing out a playerId to a session that will
      // never be minted is a detail with no use but a caller.
      if (verdict.reason === 'suspended') {
        return {
          ok: false,
          reason: 'suspended',
          ...(verdict.suspendedReason ? { suspendedReason: verdict.suspendedReason } : {}),
        };
      }
      return { ok: false, reason: verdict.reason, identity: toIdentity(user) };
    }

    return { ok: true, identity: toIdentity(user) };
  },

  /**
   * Mark an address confirmed. Called only after a correct code.
   *
   * Keyed on playerId taken from the CHALLENGE, not from anything the client
   * sent, so a correct code can only ever confirm the account it was issued for.
   */
  async markEmailVerified(
    playerId: string,
    /**
     * Credentials bound to the challenge whose code was just proved. Applied
     * HERE and nowhere earlier — this is the moment control of the address is
     * demonstrated, and therefore the only moment at which it is safe to let a
     * signup attempt set the password on an account that already existed.
     */
    pending?: { passwordHash: string; displayName?: string },
  ): Promise<EmailVerifyResult> {
    const updated = await UserModel.findOneAndUpdate(
      { _id: playerId },
      {
        $set: {
          emailVerified: true,
          ...(pending
            ? {
                passwordHash: pending.passwordHash,
                ...(pending.displayName ? { displayName: pending.displayName } : {}),
              }
            : {}),
        },
      },
      { new: true },
    ).lean();
    if (!updated) return { ok: false, reason: 'no_account' };

    // THE SAME RULE the password and Google paths run, at the third door.
    //
    // Confirming an address proves control of a mailbox. It says nothing about
    // whether an administrator has since banned the account, and this door used
    // to return a bare identity that the caller turned straight into a token —
    // so a suspended player who signed up again walked back in through their own
    // inbox. Shaped as a verdict for the reason `oauth` is: the caller cannot
    // reach the identity without stepping past the refusal, so a future call
    // site cannot forget the check.
    //
    // The write above is left standing on purpose: the address genuinely IS
    // confirmed, and rolling it back would lose a true fact to express a
    // separate one. Suspension is what blocks, and it is reported as itself.
    const verdict = isSignInAllowed(updated as UserDoc);
    if (!verdict.ok && verdict.reason === 'suspended') {
      return {
        ok: false,
        reason: 'suspended',
        ...(verdict.suspendedReason ? { suspendedReason: verdict.suspendedReason } : {}),
      };
    }
    return { ok: true, identity: toIdentity(updated as UserDoc) };
  },

  /**
   * Google sign-in.
   *
   * RETURNS A VERDICT RATHER THAN AN IDENTITY, so that suspension is enforced
   * here too. It was not, and that was a hole with a straight line through it:
   * an administrator suspends an account, the player clicks "Sign in with
   * Google", and is back — because this path never consulted `isSignInAllowed`
   * at all. A ban enforced on one of two doors is not a ban.
   *
   * Shaped like `PasswordCheck` for the same reason that one is a result: the
   * caller cannot reach the identity without first stepping past the refusal,
   * so the check cannot be forgotten at a new call site.
   *
   * `emailVerified` is not consulted for OAuth — Google confirming the address
   * IS the confirmation, and `findOrCreateGoogle` writes `true` explicitly.
   */
  async oauth(
    googleId: string,
    email: string,
    displayName?: string,
    photoUrl?: string,
  ): Promise<
    { ok: true; identity: StoredIdentity } | { ok: false; reason: 'suspended'; suspendedReason?: string }
  > {
    const user = await findOrCreateGoogle(googleId, email, displayName, photoUrl);

    // THE SAME RULE the password path runs, not a second copy of it. An earlier
    // draft re-read `user.suspendedAt` here directly, which is exactly the shape
    // this codebase keeps warning about: two implementations of one rule
    // eventually give two answers, and the answer here is whether a banned
    // player gets back in.
    //
    // `email_unverified` is deliberately not acted on: Google confirming the
    // address IS the confirmation, and `findOrCreateGoogle` writes `true`.
    const verdict = isSignInAllowed(user);
    if (!verdict.ok && verdict.reason === 'suspended') {
      return {
        ok: false,
        reason: 'suspended',
        ...(verdict.suspendedReason ? { suspendedReason: verdict.suspendedReason } : {}),
      };
    }
    return { ok: true, identity: toIdentity(user) };
  },

  /**
   * Change the display name on an existing account. New name only — this is
   * not signup, so there is nothing else to re-validate here. The caller
   * (`gateway/auth.ts`) runs `validateDisplayName` before this is reached;
   * this trusts that and just writes the field.
   */
  async updateDisplayName(playerId: string, displayName: string): Promise<StoredIdentity | null> {
    const updated = await UserModel.findOneAndUpdate(
      { _id: playerId },
      { $set: { displayName } },
      { new: true },
    ).lean();
    return updated ? toIdentity(updated as UserDoc) : null;
  },

  /**
   * Change the password on an AUTHENTICATED account, given the current one.
   *
   * The current-password check is the entire point of this endpoint — see
   * `gateway/auth.ts` — and it runs through `userStore.verifyPassword`,
   * the exact path `/auth/login` uses, rather than a second `bcrypt.compare`
   * written here that could quietly drift from it.
   *
   * Refuses with `no_password`, not `invalid_current_password`, for a
   * Google-linked account that has never set one: there is nothing to check
   * a supplied password against, and the two failures need different words at
   * the route.
   */
  async changePassword(
    playerId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<ChangePasswordResult> {
    const user = await UserModel.findById(playerId).lean();
    if (!user) return { ok: false, reason: 'no_account' };
    if (!user.passwordHash) return { ok: false, reason: 'no_password' };

    const identifier = user.email || user.phone;
    if (!identifier) return { ok: false, reason: 'no_account' };

    const check = await userStore.verifyPassword(identifier, currentPassword);
    if (!check.ok) return { ok: false, reason: 'invalid_current_password' };

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await UserModel.updateOne({ _id: playerId }, { $set: { passwordHash } });
    return { ok: true };
  },

  /**
   * What the forgot-password flow needs to know about an address, in a shape
   * that lets the ROUTE answer identically whether or not it exists.
   *
   * `hasPassword` is reported rather than assumed: a Google-linked account
   * may still hold no `passwordHash`, and the route must neither mail it a
   * code nor create one — see the Google-account comment in `gateway/auth.ts`.
   */
  async findForPasswordReset(
    email: string,
  ): Promise<{ playerId: string; hasPassword: boolean } | null> {
    const user = await findByIdentifier(email);
    if (!user) return null;
    return { playerId: user._id, hasPassword: Boolean(user.passwordHash) };
  },

  /**
   * Set a new password after a correct forgot-password code.
   *
   * Keyed on the playerId the OTP CHALLENGE named, never on anything the
   * client sent directly — same discipline as `markEmailVerified` — so a
   * correct code can only ever reset the account it was issued for.
   */
  async resetPassword(playerId: string, newPassword: string): Promise<StoredIdentity | null> {
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const updated = await UserModel.findOneAndUpdate(
      { _id: playerId },
      { $set: { passwordHash } },
      { new: true },
    ).lean();
    return updated ? toIdentity(updated as UserDoc) : null;
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

  /**
   * ADMIN — the full editable record for one account, hash excluded.
   *
   * Separate from `byPlayerId` because it answers a different question: that one
   * feeds a player their own profile, this one feeds an administrator a form.
   * The two drifting apart is fine and intended — a field an admin may edit is
   * not automatically a field a player may see about themselves.
   */
  async adminGet(playerId: string): Promise<AdminUserRecord | null> {
    const d = await UserModel.findById(playerId).lean();
    if (!d) return null;
    return toAdminRecord(d as UserDoc);
  },

  /**
   * ADMIN — write the editable identity fields.
   *
   * Returns the record BEFORE and AFTER, because that pair is the whole content
   * of an audit entry. Building the audit log from the request body instead
   * would record what was asked for rather than what happened — and those differ
   * exactly when something went wrong, which is when the log is read.
   *
   * `undefined` means "leave alone" and `null` means "clear"; they are different
   * intentions and a single falsy check would collapse them, silently wiping a
   * field the admin never touched.
   */
  async adminUpdate(
    playerId: string,
    patch: AdminUserPatch,
    /** Runs inside the caller's transaction, so the audit entry cannot be lost. */
    session?: ClientSession,
  ): Promise<
    | { ok: true; before: AdminUserRecord; after: AdminUserRecord }
    | { ok: false; reason: 'no_account' | 'email_taken' | 'phone_taken' }
  > {
    // Every query below carries the session, or that write lands outside the
    // transaction it is meant to be atomic with.
    const before = await UserModel.findById(playerId).session(session ?? null).lean();
    if (!before) return { ok: false, reason: 'no_account' };

    const set: Record<string, unknown> = {};
    const unset: Record<string, ''> = {};

    if (patch.displayName !== undefined) set.displayName = patch.displayName;

    if (patch.email !== undefined) {
      if (patch.email === null) {
        unset.email = '';
      } else {
        const email = patch.email.trim().toLowerCase();
        // Checked before writing rather than caught as a duplicate-key error,
        // so the admin gets "that address belongs to another account" instead
        // of a 500. The unique index is still the real guarantee under a race.
        const clash = await UserModel.findOne({ email, _id: { $ne: playerId } })
          .select('_id')
          .session(session ?? null)
          .lean();
        if (clash) return { ok: false, reason: 'email_taken' };
        set.email = email;
      }
    }

    if (patch.phone !== undefined) {
      if (patch.phone === null) {
        unset.phone = '';
      } else {
        const phone = patch.phone.trim();
        const clash = await UserModel.findOne({ phone, _id: { $ne: playerId } })
          .select('_id')
          .session(session ?? null)
          .lean();
        if (clash) return { ok: false, reason: 'phone_taken' };
        set.phone = phone;
      }
    }

    if (patch.emailVerified !== undefined) set.emailVerified = patch.emailVerified;

    // Demotion CLEARS the field rather than writing `'player'`. The schema enum
    // is `['ops']` — absence is what "player" means — so storing the string
    // would fail validation, and a `role: 'player'` document would read as
    // neither one thing nor the other to anything checking `u.role`.
    if (patch.role !== undefined) {
      if (patch.role === 'ops') set.role = 'ops';
      else unset.role = '';
    }

    if (patch.photoUrl !== undefined) {
      if (patch.photoUrl === null) unset.photoUrl = '';
      else set.photoUrl = patch.photoUrl;
    }

    const update: Record<string, unknown> = {};
    if (Object.keys(set).length > 0) update.$set = set;
    if (Object.keys(unset).length > 0) update.$unset = unset;

    // A patch that asked for nothing is not an error — it is a no-op, and the
    // caller still gets a before/after pair (identical) rather than a special
    // case to handle.
    const after =
      Object.keys(update).length === 0
        ? before
        : ((await UserModel.findOneAndUpdate({ _id: playerId }, update, {
            new: true,
            ...(session ? { session } : {}),
          }).lean()) ?? before);

    return {
      ok: true,
      before: toAdminRecord(before as UserDoc),
      after: toAdminRecord(after as UserDoc),
    };
  },

  /**
   * ADMIN — suspend or reinstate.
   *
   * `suspendedBy` comes from the caller, which reads it off the verified token —
   * the same discipline as `approvedBy` on a withdrawal. An admin action nobody
   * is named for is not an admin action.
   */
  async adminSetSuspended(
    playerId: string,
    suspended: boolean,
    actorPlayerId: string,
    reason?: string,
    /** Runs inside the caller's transaction, so the audit entry cannot be lost. */
    session?: ClientSession,
  ): Promise<{ before: AdminUserRecord; after: AdminUserRecord } | null> {
    const before = await UserModel.findById(playerId).session(session ?? null).lean();
    if (!before) return null;

    const update = suspended
      ? {
          $set: {
            suspendedAt: new Date(),
            suspendedBy: actorPlayerId,
            ...(reason ? { suspendedReason: reason } : {}),
          },
        }
      : { $unset: { suspendedAt: '', suspendedBy: '', suspendedReason: '' } };

    const after = await UserModel.findOneAndUpdate({ _id: playerId }, update, {
      new: true,
      ...(session ? { session } : {}),
    }).lean();
    return {
      before: toAdminRecord(before as UserDoc),
      after: toAdminRecord((after ?? before) as UserDoc),
    };
  },

  /**
   * ADMIN — set a password directly, with no current-password check.
   *
   * That omission is the point and the risk. It exists because a player locked
   * out of their email cannot use the self-service reset, and support has to be
   * able to restore access. It is why every call is audited by the route, and
   * why the new password is never echoed back or stored anywhere but the hash.
   *
   * Refuses on an account with no email or phone rather than creating a
   * password nobody can ever use to sign in.
   */
  async adminSetPassword(
    playerId: string,
    newPassword: string,
    /** Runs inside the caller's transaction, so the audit entry cannot be lost. */
    session?: ClientSession,
  ): Promise<{ ok: true } | { ok: false; reason: 'no_account' | 'no_identifier' }> {
    const user = await UserModel.findById(playerId).session(session ?? null).lean();
    if (!user) return { ok: false, reason: 'no_account' };
    if (!user.email && !user.phone) return { ok: false, reason: 'no_identifier' };

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await UserModel.updateOne(
      { _id: playerId },
      { $set: { passwordHash } },
      session ? { session } : {},
    );
    return { ok: true };
  },

  /**
   * One identity by playerId, or null for a Telegram player (who has none).
   *
   * `hasPassword` is reported alongside identity, not just inside
   * `findForPasswordReset`, because `/auth/me` needs the same fact: whether a
   * Google-linked account can render a change-password form at all. It is a
   * boolean derived from `passwordHash` -- the hash itself is never part of
   * this or any other return value here.
   */
  /**
   * May this player hold a live-table socket right now?
   *
   * A verdict, not a document, for the reason `oauth` and `markEmailVerified`
   * are verdicts: the caller cannot reach an "allowed" without stepping past
   * the refusal. `byPlayerId` cannot answer this — `StoredIdentity` carries no
   * `suspendedAt`, which is precisely why the socket never asked.
   *
   * A MISSING ROW MEANS ALLOWED, and that is not an oversight. Telegram players
   * have no identity document at all (see `byPlayerIds`), so reading absence as
   * a ban would lock every Telegram player out of every table — a far larger
   * outage than the hole being closed. Only an existing, suspended row refuses.
   *
   * Only suspension is consulted, not `emailVerified`: an unconfirmed account
   * can never hold a token in the first place (`verifyPassword` and now
   * `markEmailVerified` both refuse), so re-checking it here would add a second
   * copy of a rule for no reachable case.
   */
  async canHoldSession(playerId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const doc = await UserModel.findById(playerId).lean();
    if (!doc) return { ok: true };
    const verdict = isSignInAllowed(doc as UserDoc);
    if (!verdict.ok && verdict.reason === 'suspended') {
      return { ok: false, reason: 'suspended' };
    }
    return { ok: true };
  },

  async byPlayerId(
    playerId: string,
  ): Promise<(StoredIdentity & { createdAt: string; hasPassword: boolean }) | null> {
    const doc = await UserModel.findById(playerId).lean();
    if (!doc) return null;
    return {
      ...toIdentity(doc as UserDoc),
      createdAt: doc.createdAt.toISOString(),
      hasPassword: Boolean(doc.passwordHash),
    };
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
   * Just the suspension state and current role, for the per-request gate.
   *
   * Its own method, selecting two fields, because it runs on the hot path —
   * the gate consults it for every authenticated request that misses its
   * cache, and pulling a whole user document (hash included) to read a date
   * and a role would be both wasteful and a credential loaded for no reason.
   * `role` rides along with `suspendedAt` rather than getting its own method
   * because `SuspensionGate` answers both questions from one cached entry —
   * see that file — so one query should fill both rather than two.
   *
   * `null` for a player with no identity document — every Telegram player —
   * which the gate reads as "not suspendable" AND "not ops": there is no
   * document for either fact to live on.
   */
  async suspensionOf(
    playerId: string,
  ): Promise<{ suspendedAt: Date | null; role: 'player' | 'ops' } | null> {
    const doc = await UserModel.findById(playerId).select('suspendedAt role').lean();
    if (!doc) return null;
    return { suspendedAt: doc.suspendedAt ?? null, role: doc.role ?? 'player' };
  },

  /**
   * Registered identities, newest first — the other half of the admin Users list.
   *
   * The list was built from financial-core's players alone, which is every
   * account money has touched. A web sign-up that has never deposited or played
   * has no financial account yet, so it did not appear at all: someone could
   * register, fail to get in, contact support, and be told no such account
   * exists. New sign-ups are exactly who support is asked about first.
   *
   * `createdAt` comes back so the merged list can be ordered against
   * financial-core's `joinedAt` on one comparable field.
   */
  async listIdentities(
    limit: number,
  ): Promise<(StoredIdentity & { createdAt: string })[]> {
    const docs = await UserModel.find({}).sort({ createdAt: -1 }).limit(limit).lean();
    return docs.map((d) => ({
      ...toIdentity(d as UserDoc),
      createdAt: d.createdAt.toISOString(),
    }));
  },

  /**
   * Create a platform administrator (role: 'ops'). Email + password only — an
   * admin never signs in with Telegram or Google, so `ops` can only be minted
   * through the credential path this creates. Throws on a weak password or a
   * taken email rather than silently making a second, unreachable account.
   */
  async createAdmin(
    email: string,
    password: string,
    displayName?: string,
    /** Runs inside the caller's transaction, so the audit entry cannot be lost. */
    session?: ClientSession,
  ): Promise<StoredIdentity> {
    const clean = email.trim().toLowerCase();
    // The shared rules, as the route now runs them too. Kept here as well
    // because this is the store's own guarantee — a future caller that forgets
    // the route's check must still not mint a weak administrator.
    const emailVerdict = validateEmailAddress(clean);
    if (!emailVerdict.ok) throw new Error('an admin needs an email address');
    const passwordVerdict = validatePasswordStrength(password);
    if (!passwordVerdict.ok) throw new Error(passwordVerdict.message);
    if (await findByIdentifier(clean)) throw new Error('an account with this email already exists');
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const [user] = await UserModel.create(
      [
        {
          email: clean,
          passwordHash,
          displayName: displayName?.trim() || (clean.split('@')[0] ?? clean),
          role: 'ops',
        },
      ],
      // `create` takes an array when given a session — the single-document form
      // silently ignores it, which would leave the account committed outside
      // the transaction that carries its audit entry.
      session ? { session } : {},
    );
    return toIdentity(user!.toObject());
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
