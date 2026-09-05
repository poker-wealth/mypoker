import { isSignInAllowed, isClaimableBySignup, type SignInSubject } from '../../src/auth/sign-in-rules';

/**
 * A document whose key is PRESENT and undefined, rather than absent.
 *
 * `exactOptionalPropertyTypes` forbids writing that literally, and rightly —
 * but the two are the same at runtime and a real object can hold either. A
 * spread of an object missing the key, or a `.lean()` result, both reach this
 * function; the rule must give the same answer for both.
 */
const present = (o: Record<string, unknown>): SignInSubject => o as SignInSubject;

/**
 * Who may hold a session.
 *
 * One pure function, so these are cheap — and they are the only thing standing
 * between "an administrator suspended this account" and the player carrying on
 * as though nothing happened.
 */
describe('isSignInAllowed', () => {
  it('allows an account with nothing set against it', () => {
    expect(isSignInAllowed({})).toEqual({ ok: true });
  });

  it('allows an account whose email was never asked about', () => {
    // `undefined` is every account created before confirmation existed. Reading
    // it as "unconfirmed" would sign out the entire existing user base.
    expect(isSignInAllowed(present({ emailVerified: undefined }))).toEqual({ ok: true });
  });

  it('blocks only an EXPLICIT false', () => {
    expect(isSignInAllowed({ emailVerified: false })).toEqual({
      ok: false,
      reason: 'email_unverified',
    });
  });

  it('blocks a suspended account', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    expect(isSignInAllowed({ suspendedAt: at })).toEqual({ ok: false, reason: 'suspended' });
  });

  it('carries the reason so the player can be told why', () => {
    const verdict = isSignInAllowed({
      suspendedAt: new Date(),
      suspendedReason: 'chargeback under review',
    });
    expect(verdict).toEqual({
      ok: false,
      reason: 'suspended',
      suspendedReason: 'chargeback under review',
    });
  });

  it('reports SUSPENDED, not email_unverified, when both are true', () => {
    // The order is the point. Sent to the confirm-your-email screen, a suspended
    // player enters a correct code, watches it succeed, and still cannot sign
    // in — which reads as a broken app rather than as a decision someone made.
    const verdict = isSignInAllowed({
      emailVerified: false,
      suspendedAt: new Date(),
      suspendedReason: 'fraud',
    });
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: 'suspended' });
  });

  it('lets a reinstated account back in', () => {
    // Reinstatement $unsets the field, so absent must mean active — if this
    // read a lingering `null` as truthy, a lifted ban would never lift.
    expect(
      isSignInAllowed(present({ suspendedAt: undefined, suspendedReason: undefined })),
    ).toEqual({ ok: true });
  });
});

describe('isClaimableBySignup', () => {
  /**
   * The ban-evasion path, as a test.
   *
   * An administrator suspends an account. Its owner signs up again with the
   * same address. Before this rule existed the predicate was
   * `!isSignInAllowed(u).ok` — true for a suspended account — so the signup
   * rewrote the password, cleared `emailVerified`, left `suspendedAt` alone,
   * and `/auth/verify-otp` handed back a token for a code delivered to the
   * banned player's own inbox.
   */
  it('refuses to hand a suspended account to a new signup', () => {
    expect(
      isClaimableBySignup({ emailVerified: false, suspendedAt: new Date(), suspendedReason: 'fraud' }),
    ).toBe(false);
  });

  it('refuses a suspended account that had confirmed its address', () => {
    expect(isClaimableBySignup({ emailVerified: true, suspendedAt: new Date() })).toBe(false);
  });

  it('refuses a confirmed, active account — that address belongs to someone', () => {
    expect(isClaimableBySignup({ emailVerified: true })).toBe(false);
  });

  it('refuses an account predating confirmation, where the field is absent', () => {
    // Absent is not `false`. Those rows are real accounts belonging to real
    // people; reading "unknown" as "claimable" would put every one of them up
    // for grabs (docs/TRAPS.md §3, the same shape applied to identity).
    expect(isClaimableBySignup({})).toBe(false);
  });

  it('allows only an unconfirmed, unsuspended account', () => {
    expect(isClaimableBySignup({ emailVerified: false })).toBe(true);
  });
});
