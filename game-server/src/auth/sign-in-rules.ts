/**
 * Who may hold a session.
 *
 * One pure function, in its own file, because the answer has to be identical
 * everywhere it is asked — the password path, the OTP path, and anything added
 * later. A second copy of this rule eventually gives a second answer, and the
 * answer here is whether an unconfirmed address can play for money.
 */

/** Just the fields the rule reads. */
export interface SignInSubject {
  emailVerified?: boolean;
  suspendedAt?: Date;
  suspendedReason?: string;
}

export type SignInVerdict =
  | { ok: true }
  | { ok: false; reason: 'email_unverified' }
  | { ok: false; reason: 'suspended'; suspendedReason?: string };

/**
 * ONLY AN EXPLICIT `false` BLOCKS.
 *
 * `emailVerified` is absent on every account created before confirmation
 * existed. Reading `undefined` as "unconfirmed" would sign out the entire
 * existing user base on deploy and give them no way back in — the confirmation
 * flow only ever mints a code for an account it just created, so there would be
 * nothing to resend. Accounts that went through the gated signup carry an
 * explicit `false`; those are the ones this stops.
 *
 * Not `?? true` — see docs/TRAPS.md §3. The same shape that turns "unknown"
 * into a false claim about money turns it into a false claim about identity
 * here; the difference is that this one is deliberate, narrow, and written down.
 */
export function isSignInAllowed(user: SignInSubject): SignInVerdict {
  // Suspension is checked FIRST and reported as itself. A suspended account that
  // is also unconfirmed would otherwise be sent to the confirm-your-email screen,
  // where a correct code appears to work and sign-in still fails — the player
  // reads that as a broken app rather than as a decision someone made about
  // their account. The stronger fact is the one worth saying.
  if (user.suspendedAt) {
    return {
      ok: false,
      reason: 'suspended',
      ...(user.suspendedReason ? { suspendedReason: user.suspendedReason } : {}),
    };
  }
  if (user.emailVerified === false) return { ok: false, reason: 'email_unverified' };
  return { ok: true };
}

/**
 * May a fresh signup TAKE OVER an account that already exists on this address?
 *
 * Stated positively, and in this file, because it is the same question
 * `isSignInAllowed` answers pointed the other way — and the two must not drift.
 *
 * It lived inside `createUnverifiedWithPassword` as `!isSignInAllowed(u).ok`,
 * which reads as "reclaim anyone who cannot sign in". That is true of a
 * SUSPENDED account as well as an unconfirmed one, so signing up again with a
 * banned address rewrote its password and cleared `emailVerified` while leaving
 * `suspendedAt` in place. The confirmation door then handed over a token. A ban
 * a signup form can lift is not a ban.
 *
 * Only an account that has never been confirmed AND is not suspended is
 * claimable. Note this deliberately does NOT read `emailVerified` as truthy:
 * only an explicit `false` — an account created by the gated signup — qualifies.
 * Rows predating confirmation have the field absent, and those are real accounts
 * belonging to real people, not free addresses.
 *
 * Still open, and not what this fixes: an UNCONFIRMED account is claimable by
 * anyone who knows the address, so an attacker can overwrite a pending signup's
 * password before its owner confirms. Closing that needs the credentials bound
 * to the challenge that was mailed rather than written to the row up front.
 */
export function isClaimableBySignup(user: SignInSubject): boolean {
  return user.emailVerified === false && !user.suspendedAt;
}
