/**
 * What counts as an acceptable email and password at sign-up.
 *
 * ENFORCED ON THE SERVER, because until now it was not enforced anywhere that
 * an attacker cannot skip. The web form relied on `type="email"` and nothing
 * else; the native form checked both rules in `LoginScreen.tsx` and the gateway
 * checked neither. A one-character password and an address of `a@b` both
 * created real accounts, and so did one containing a space.
 *
 * Neither rule is invented here. The length is the one the native client
 * already showed people ("Password must be at least 8 characters",
 * `auth.passwordTooShort`, translated into all eight locales), and the pattern
 * is the one `LoginScreen.tsx` already used. Moving them to the server makes
 * them true rather than advisory; the clients keep theirs so the message
 * arrives before a round trip.
 */

/**
 * Deliberately the same expression the native client uses.
 *
 * Not an RFC 5322 parser, and not trying to be — the only address that truly
 * validates is one that receives a code, which is what the whole confirmation
 * flow is for. This exists to reject what is obviously not an address before a
 * row is written, so that "no account created" is true for the cases a person
 * would actually call invalid.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Matches `auth.passwordTooShort`, which is already translated everywhere. */
export const MIN_PASSWORD_LENGTH = 8;

export type CredentialVerdict =
  | { ok: true }
  | { ok: false; code: 'email_invalid' | 'password_too_short'; message: string };

/**
 * Check a sign-up before any account row exists.
 *
 * Order matters only for which message is shown first, and email comes first
 * because it is the field the rest of the flow depends on.
 */
export function validateSignupCredentials(email: string, password: string): CredentialVerdict {
  if (!EMAIL.test(email)) {
    return {
      ok: false,
      code: 'email_invalid',
      message: 'Enter a valid email address.',
    };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      code: 'password_too_short',
      // The number comes from the constant, so the sentence cannot drift from
      // the rule the way a hardcoded "8" eventually does.
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  return { ok: true };
}
