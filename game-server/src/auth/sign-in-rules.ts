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
}

export type SignInVerdict = { ok: true } | { ok: false; reason: 'email_unverified' };

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
  if (user.emailVerified === false) return { ok: false, reason: 'email_unverified' };
  return { ok: true };
}
