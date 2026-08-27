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
 * The password-strength half of sign-up, on its own.
 *
 * Pulled out so that change-password and forgot-password confirm apply
 * EXACTLY this rule rather than a second copy of it — `validateSignupCredentials`
 * below now calls this too, so there is one rule, not two that can drift.
 */
export function validatePasswordStrength(password: string): CredentialVerdict {
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

/**
 * The email half on its own, for callers that change an address without setting
 * a password — the admin edit form.
 *
 * Exported so an administrator's edit meets EXACTLY the bar a sign-up does. An
 * admin panel with a looser rule is how an address that no code can reach gets
 * onto a confirmed account.
 */
export function validateEmailAddress(email: string): CredentialVerdict {
  if (!EMAIL.test(email)) {
    return { ok: false, code: 'email_invalid', message: 'Enter a valid email address.' };
  }
  return { ok: true };
}

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
  return validatePasswordStrength(password);
}

/**
 * Display names. NOT part of sign-up validation before this change — signup
 * accepts an optional name and falls back to the email's local part with no
 * rule of its own (`user-store.ts#createUnverifiedWithPassword`). Added HERE,
 * as its own function, so that the change-display-name route in
 * `gateway/auth.ts` has one rule to call rather than an inline check — and so
 * that if signup is ever made to validate the name it typed in, it reuses this
 * rather than inventing a second one.
 */
export const MAX_DISPLAY_NAME_LENGTH = 40;

export type DisplayNameVerdict =
  | { ok: true; displayName: string }
  | { ok: false; code: 'display_name_required' | 'display_name_too_long'; message: string };

export function validateDisplayName(raw: string): DisplayNameVerdict {
  const displayName = raw.trim();
  if (!displayName) {
    return {
      ok: false,
      code: 'display_name_required',
      message: 'Enter a display name.',
    };
  }
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return {
      ok: false,
      code: 'display_name_too_long',
      message: `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, displayName };
}
