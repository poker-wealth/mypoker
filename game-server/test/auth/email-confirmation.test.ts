import express, { type Express } from 'express';
import request from 'supertest';
import { buildAuthRouter, type AuthUserStore } from '../../src/gateway/auth';
import { loadConfig } from '../../src/gateway/config';
import { verifyToken } from '../../src/gateway/tokens';
import { createOtpStore, type OtpPersistence, type StoredOtp } from '../../src/auth/otp-store';
import { isSignInAllowed, isClaimableBySignup } from '../../src/auth/sign-in-rules';
import type { OtpMailRequest, OtpDelivery } from '../../src/gateway/mailer';
import type { StoredIdentity, PasswordCheck } from '../../src/auth/user-store';
import { OTP_MAX_ATTEMPTS, OTP_MAX_SENDS, OTP_RESEND_COOLDOWN_MS, OTP_TTL_MS } from '../../src/auth/otp-rules';

/**
 * The confirmation flow, end to end over HTTP.
 *
 * This drives the REAL routes and the REAL `createOtpStore` — the same rule
 * calls, the same bcrypt hashing, the same consume-on-success — with a Map
 * behind the persistence port instead of Mongo. Only two things are stand-ins:
 * the mailbox (a capture) and the clock (a variable).
 *
 * That matters here specifically. docs/TRAPS.md #1 records 24 gateway tests
 * passing with a security guard disabled, because they mocked the store and so
 * only ever proved that a flag was passed. The guard in this file is the store
 * itself, so mocking it would prove nothing at all.
 *
 * What is NOT covered here is `userStore`'s own persistence — the reclaim rule
 * and the confirmed/unconfirmed column. That runs against real Mongo in
 * user-store.test.ts.
 */

const JWT_SECRET = 'test-jwt-secret';
const T0 = 1_700_000_000_000;

// ── the stand-ins ───────────────────────────────────────────────────────────

function memoryPersistence(): OtpPersistence {
  const rows = new Map<string, StoredOtp>();
  return {
    // Copies in and out, so a caller holding a returned object cannot mutate
    // the store by accident — which a Mongo-backed store would never allow and
    // a Map-backed one silently would.
    async get(key) {
      const row = rows.get(key);
      return row ? { ...row } : null;
    },
    async put(key, value) {
      rows.set(key, { ...value });
    },
    async incrementAttempts(key) {
      const row = rows.get(key);
      if (row) rows.set(key, { ...row, attempts: row.attempts + 1 });
    },
    async delete(key) {
      rows.delete(key);
    },
  };
}

interface FakeUser {
  playerId: string;
  email: string;
  password: string;
  displayName: string;
  emailVerified?: boolean;
  /**
   * Suspension. Absent from this fake until now, which is a large part of why
   * the ban-evasion path was invisible here: the confirmation suite could not
   * express a suspended account, so no test could ask what happens when one
   * signs up again. The fields `isSignInAllowed` and `isClaimableBySignup`
   * actually read, and nothing else.
   */
  suspendedAt?: Date;
  suspendedReason?: string;
}

/**
 * Identity persistence as a Map.
 *
 * The two rules that matter are the SHARED ones: `isSignInAllowed`, imported
 * rather than restated, and the reclaim-an-unconfirmed-account rule, mirrored
 * from `createUnverifiedWithPassword`. Password hashing is a plain comparison —
 * bcrypt is not what is under test and costs a second a call.
 */
function memoryUsers(seed: FakeUser[] = []): AuthUserStore & { rows: Map<string, FakeUser> } {
  const rows = new Map<string, FakeUser>(seed.map((u) => [u.email, u]));
  let nextId = 1;

  const identity = (u: FakeUser): StoredIdentity => ({
    playerId: u.playerId,
    email: u.email,
    displayName: u.displayName,
    photoUrl: null,
  });

  return {
    rows,
    async startSignup(rawEmail, password, displayName) {
      const email = rawEmail.trim().toLowerCase();
      const existing = rows.get(email);
      // The REAL predicate. This fake used to carry `isSignInAllowed(u).ok`,
      // the same inversion the production code had, so the suite reproduced
      // the bug faithfully and reported it as correct behaviour.
      if (existing && !isClaimableBySignup(existing)) {
        throw new Error('User with this email or phone number already exists');
      }
      // An address that already has an unconfirmed account KEEPS its
      // credentials. The new ones ride on the challenge and are applied only
      // when its code comes back — mirrored here because a fake that overwrote
      // the row would let the takeover test pass while the real store stayed
      // vulnerable.
      if (existing) {
        return {
          identity: identity(existing),
          pending: { passwordHash: password, ...(displayName ? { displayName } : {}) },
        };
      }

      const user: FakeUser = {
        playerId: `player-${nextId++}`,
        email,
        password,
        displayName: displayName || email.split('@')[0]!,
        emailVerified: false,
      };
      rows.set(email, user);
      return { identity: identity(user) };
    },
    async verifyPassword(rawEmail, password): Promise<PasswordCheck> {
      const user = rows.get(rawEmail.trim().toLowerCase());
      if (!user || user.password !== password) {
        return { ok: false, reason: 'invalid_credentials' };
      }
      const verdict = isSignInAllowed(user);
      if (!verdict.ok) return { ok: false, reason: verdict.reason, identity: identity(user) };
      return { ok: true, identity: identity(user) };
    },
    async markEmailVerified(playerId, pending) {
      for (const user of rows.values()) {
        if (user.playerId === playerId) {
          user.emailVerified = true;
          // Applied at confirmation, never at signup — the binding under test.
          if (pending) {
            user.password = pending.passwordHash;
            if (pending.displayName) user.displayName = pending.displayName;
          }
          // The fake runs the REAL rule rather than its own copy. A mock that
          // always says "ok" is how a suspended account got a token through
          // this door while the suite stayed green (docs/TRAPS.md §1).
          const verdict = isSignInAllowed(user);
          if (!verdict.ok && verdict.reason === 'suspended') {
            return {
              ok: false,
              reason: 'suspended',
              ...(verdict.suspendedReason ? { suspendedReason: verdict.suspendedReason } : {}),
            };
          }
          return { ok: true, identity: identity(user) };
        }
      }
      return { ok: false, reason: 'no_account' };
    },
    async oauth() {
      throw new Error('not used in this suite');
    },
    async updateDisplayName() {
      throw new Error('not used in this suite');
    },
    async changePassword() {
      throw new Error('not used in this suite');
    },
    async findForPasswordReset() {
      throw new Error('not used in this suite');
    },
    async resetPassword() {
      throw new Error('not used in this suite');
    },
  };
}

// ── the harness ─────────────────────────────────────────────────────────────

interface Harness {
  app: Express;
  users: ReturnType<typeof memoryUsers>;
  /** Every message the mailer was asked to send, in order. */
  outbox: OtpMailRequest[];
  /** The code from the most recent message. */
  lastCode(): string;
  advance(ms: number): void;
}

function harness(
  opts: {
    env?: Record<string, string | undefined>;
    seed?: FakeUser[];
    delivery?: () => OtpDelivery;
  } = {},
): Harness {
  let clock = T0;
  const outbox: OtpMailRequest[] = [];
  const users = memoryUsers(opts.seed);

  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: '123456:TEST-BOT-TOKEN',
    JWT_SECRET,
    DEV_AUTH_BYPASS: 'true',
    ...opts.env,
  } as NodeJS.ProcessEnv);

  const app = express();
  app.use(express.json());
  app.use(
    '/auth',
    buildAuthRouter(config, {
      users,
      otps: createOtpStore(memoryPersistence()),
      now: () => clock,
      mailer: async (message) => {
        outbox.push(message);
        return opts.delivery ? opts.delivery() : { outcome: 'sent' };
      },
    }),
  );

  return {
    app,
    users,
    outbox,
    lastCode: () => {
      const last = outbox[outbox.length - 1];
      if (!last) throw new Error('nothing was mailed');
      return last.code;
    },
    advance: (ms) => {
      clock += ms;
    },
  };
}

const signUp = (h: Harness, email = 'ada@example.com', password = 'correct horse battery') =>
  request(h.app).post('/auth/signup').send({ email, password, displayName: 'Ada' });

// ── the happy path ──────────────────────────────────────────────────────────

describe('sign-up is not finished until the code is confirmed', () => {
  it('returns no token from /signup — only a pending confirmation', async () => {
    const h = harness();
    const res = await signUp(h);

    expect(res.status).toBe(200);
    // The single most important assertion in this file. If a token ever comes
    // back here, the confirmation step is decoration and every test below can
    // still pass.
    expect(res.body.token).toBeUndefined();
    expect(res.body).toMatchObject({ pending: true, email: 'ada@example.com' });
    expect(new Date(res.body.expiresAt).getTime()).toBe(T0 + OTP_TTL_MS);
  });

  it('never puts the code in the HTTP response', async () => {
    const h = harness();
    const res = await signUp(h);

    expect(h.outbox).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain(h.lastCode());
  });

  it('mails exactly one code, to the address that signed up', async () => {
    const h = harness();
    await signUp(h, 'Ada@Example.COM');

    expect(h.outbox).toHaveLength(1);
    // Normalised — otherwise the challenge is keyed on one spelling and the
    // confirmation arrives under another.
    expect(h.outbox[0]!.to).toBe('ada@example.com');
    expect(h.outbox[0]!.code).toMatch(/^\d{6}$/);
  });

  it('mints a usable session once the correct code is presented', async () => {
    const h = harness();
    await signUp(h);

    const res = await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code: h.lastCode() });

    expect(res.status).toBe(200);
    expect(res.body.player).toMatchObject({ displayName: 'Ada' });
    // Not just "a token came back" — one the Financial Core will accept.
    const claims = verifyToken(res.body.token, JWT_SECRET);
    expect(claims.playerId).toBe(res.body.player.playerId);
    expect(claims.role).toBe('player');
  });

  /**
   * Ban evasion, as the reviewer described it: suspend a confirmed account,
   * sign up again on the same address, read the code out of your own inbox.
   *
   * Two separate defects had to line up, so this asserts at BOTH doors rather
   * than only the one that happened to be checked first — a later change that
   * reopens either half fails here.
   */
  it('does not let a suspended account sign up again and confirm its way back in', async () => {
    const h = harness();
    await signUp(h);
    await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code: h.lastCode() });

    // An administrator bans the account.
    const row = h.users.rows.get('ada@example.com')!;
    row.suspendedAt = new Date();
    row.suspendedReason = 'collusion';

    // Door one: signing up again must not hand over the existing account.
    const again = await request(h.app)
      .post('/auth/signup')
      .send({ email: 'ada@example.com', password: 'a brand new password', displayName: 'Ada' });
    expect(again.status).toBeGreaterThanOrEqual(400);

    // The row is untouched: same password, still confirmed, still suspended.
    const after = h.users.rows.get('ada@example.com')!;
    expect(after.password).toBe('correct horse battery');
    expect(after.emailVerified).toBe(true);
    expect(after.suspendedAt).toBeDefined();

    // Door two is covered by its own test below. It is deliberately NOT
    // asserted here: with the reclaim closed, no new challenge is issued, so
    // the only code in the outbox is the one already spent on the first
    // confirmation. Asserting a 403 here would pass on `no_challenge` — a
    // green light for the wrong reason, which is the failure mode this suite
    // exists to avoid (docs/TRAPS.md §1).
  });

  /**
   * The second door, on its own and genuinely reachable: sign up, get
   * suspended before confirming, then present a perfectly valid code.
   *
   * This is what `verify-otp` never checked. It called `markEmailVerified` and
   * turned the result straight into a token, so a correct code was sufficient
   * to hold a session regardless of what an administrator had decided.
   */
  it('refuses to confirm a valid code for an account suspended while pending', async () => {
    const h = harness();
    await signUp(h);

    const row = h.users.rows.get('ada@example.com')!;
    row.suspendedAt = new Date();
    row.suspendedReason = 'fraud';

    const confirm = await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code: h.lastCode() });

    expect(confirm.status).toBe(403);
    expect(confirm.body.code).toBe('account_suspended');
    // The reason an admin wrote is shown — this is the moment it was for.
    expect(confirm.body.error).toContain('fraud');
    // The important half: no session, by any route.
    expect(confirm.body.token).toBeUndefined();
  });

  /**
   * Account takeover through a pending signup.
   *
   * An unconfirmed account is claimable by anyone who knows the address — that
   * is deliberate, so a genuine user who abandoned a signup can start again.
   * But signup used to write the new password STRAIGHT ONTO the existing row.
   * So a stranger signed up against someone else's pending signup, set the
   * password, and waited: the real owner confirmed with the code in their own
   * inbox and handed over an account whose password the stranger knew. The
   * attacker never needed the code — the victim delivered it for them.
   *
   * Credentials now ride on the challenge and are applied only when THAT
   * challenge's code is presented.
   */
  it('does not let a second signup change the password of a pending account', async () => {
    const h = harness();
    await signUp(h); // the real owner, password 'correct horse battery'

    // A stranger signs up against the same address with a password of theirs.
    await request(h.app)
      .post('/auth/signup')
      .send({ email: 'ada@example.com', password: 'attacker password', displayName: 'Ada' });

    // Nothing on the account has changed. This is the assertion that fails on
    // the old code: the row's password was rewritten on the spot.
    const row = h.users.rows.get('ada@example.com')!;
    expect(row.password).toBe('correct horse battery');
    expect(row.emailVerified).toBe(false);
  });

  it('applies the password belonging to the code that is actually presented', async () => {
    // The other half. Binding is per-CHALLENGE: `issue` replaces the challenge,
    // so the newest code is the only live one and it carries the credentials
    // typed alongside it. Someone confirming the code they just requested gets
    // the password they just chose — here, the second signup's.
    const h = harness();
    await signUp(h);

    // Past the resend cooldown, or the second signup is rate-limited and mints
    // no new code — the first version of this test asserted against the FIRST
    // challenge and failed for that reason rather than for the behaviour.
    h.advance(61_000);

    await request(h.app)
      .post('/auth/signup')
      .send({ email: 'ada@example.com', password: 'the second password', displayName: 'Ada' });

    const confirm = await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code: h.lastCode() });
    expect(confirm.status).toBe(200);

    // The second attempt's password is now live...
    const ok = await request(h.app)
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'the second password' });
    expect(ok.status).toBe(200);

    // ...and the first one is not.
    const stale = await request(h.app)
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'correct horse battery' });
    expect(stale.status).toBe(401);
  });

  it('lets the confirmed account log in with its password afterwards', async () => {
    const h = harness();
    await signUp(h);
    await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code: h.lastCode() });

    const res = await request(h.app)
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'correct horse battery' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });
});

// ── the gate itself ─────────────────────────────────────────────────────────

describe('an unconfirmed account cannot sign in', () => {
  it('refuses the password login with 403 and a code the client can route on', async () => {
    const h = harness();
    await signUp(h);

    const res = await request(h.app)
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'correct horse battery' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('email_unverified');
    expect(res.body.token).toBeUndefined();
    // The client needs this to prefill the code screen.
    expect(res.body.email).toBe('ada@example.com');
  });

  it('gives a wrong password a flat 401, revealing nothing about the account', async () => {
    const h = harness();
    await signUp(h);

    const res = await request(h.app)
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'not the password' });

    // Password first, confirmation second. A 403 here would answer "is this
    // address registered?" to anyone who typed it.
    expect(res.status).toBe(401);
    expect(res.body.code).toBeUndefined();
  });

  it('mails a fresh code, so the screen it sends the player to is usable', async () => {
    // The dead end this closes: sign up, never confirm, come back tomorrow.
    // The challenge has long expired, so a code screen with only a resend
    // button would refuse ("nothing pending") and there would be no way in.
    const h = harness();
    await signUp(h);
    h.advance(OTP_TTL_MS * 10);

    const res = await request(h.app)
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'correct horse battery' });

    expect(res.status).toBe(403);
    expect(res.body.sent).toBe(true);
    expect(h.outbox).toHaveLength(2);

    const confirmed = await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code: h.lastCode() });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.token).toBeDefined();
  });

  it('still refuses, honestly, when the cooldown stops the new code going out', async () => {
    const h = harness();
    await signUp(h);

    const res = await request(h.app)
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'correct horse battery' });

    // Still a 403 about the account, never a 429 about the code -- the login
    // did not fail for a rate-limit reason and must not say it did.
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('email_unverified');
    // `sent: false` so the screen does not promise a mail that never left.
    expect(res.body.sent).toBe(false);
    expect(res.body.retryAfterMs).toBeGreaterThan(0);
    expect(h.outbox).toHaveLength(1);
  });

  it('cannot be aimed at a stranger — the wrong password mails nothing', async () => {
    const h = harness();
    await signUp(h);
    h.advance(OTP_TTL_MS * 10);

    await request(h.app)
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'not the password' });

    // Sending mail from the login path is only safe because it takes the
    // correct password to reach it. If a failed login ever mailed, this would
    // be an open relay pointed at any address with an unconfirmed account.
    expect(h.outbox).toHaveLength(1);
  });

  it('lets accounts that predate confirmation sign in untouched', async () => {
    // The migration hazard: every existing document has no emailVerified field
    // at all. Reading that as "unconfirmed" would lock out the entire user base
    // on deploy, with no pending challenge to resend against.
    const h = harness({
      seed: [
        {
          playerId: 'player-legacy',
          email: 'old@example.com',
          password: 'hunter2',
          displayName: 'Old Timer',
        },
      ],
    });

    const res = await request(h.app)
      .post('/auth/login')
      .send({ email: 'old@example.com', password: 'hunter2' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });
});

// ── guessing ────────────────────────────────────────────────────────────────

describe('guessing the code', () => {
  it('rejects a wrong code without minting anything', async () => {
    const h = harness();
    await signUp(h);
    const wrong = h.lastCode() === '000000' ? '111111' : '000000';

    const res = await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code: wrong });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('incorrect');
    expect(res.body.token).toBeUndefined();
  });

  it('stops accepting guesses after the attempt cap, and the right code no longer works', async () => {
    const h = harness();
    await signUp(h);
    const correct = h.lastCode();
    const wrong = correct === '000000' ? '111111' : '000000';

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await request(h.app).post('/auth/verify-otp').send({ email: 'ada@example.com', code: wrong });
    }

    const res = await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code: correct });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('too_many_attempts');
    expect(res.body.token).toBeUndefined();
  });

  it('charges an attempt for a malformed guess too', async () => {
    const h = harness();
    await signUp(h);
    const correct = h.lastCode();

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      // Free malformed guesses would be a way to keep probing without ever
      // spending the budget the cap is supposed to enforce.
      await request(h.app).post('/auth/verify-otp').send({ email: 'ada@example.com', code: 'abc' });
    }

    const res = await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code: correct });
    expect(res.status).toBe(429);
  });

  it('refuses a code that has expired', async () => {
    const h = harness();
    await signUp(h);
    const code = h.lastCode();

    h.advance(OTP_TTL_MS);

    const res = await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('expired');
  });

  it('spends a code — the same one cannot confirm twice', async () => {
    const h = harness();
    await signUp(h);
    const code = h.lastCode();

    const first = await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code });
    expect(first.status).toBe(200);

    const second = await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code });
    expect(second.status).toBe(400);
    expect(second.body.code).toBe('no_challenge');
  });

  it('confirms the account the code was issued for, whatever else is in the body', async () => {
    const h = harness();
    await signUp(h, 'ada@example.com');
    const adaCode = h.lastCode();
    await signUp(h, 'bob@example.com');

    // Ada's code, presented for Ada's address, confirms Ada. There is no field
    // in the request that could redirect it at Bob — the playerId comes from
    // the challenge.
    await request(h.app).post('/auth/verify-otp').send({ email: 'ada@example.com', code: adaCode });

    expect(h.users.rows.get('ada@example.com')!.emailVerified).toBe(true);
    expect(h.users.rows.get('bob@example.com')!.emailVerified).toBe(false);
  });
});

// ── resending ───────────────────────────────────────────────────────────────

describe('resending a code', () => {
  it('refuses inside the cooldown and says how long to wait', async () => {
    const h = harness();
    await signUp(h);

    const res = await request(h.app).post('/auth/resend-otp').send({ email: 'ada@example.com' });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('cooldown');
    expect(res.headers['retry-after']).toBe('60');
    expect(h.outbox).toHaveLength(1);
  });

  it('sends a new code after the cooldown, and the old one stops working', async () => {
    const h = harness();
    await signUp(h);
    const first = h.lastCode();

    h.advance(OTP_RESEND_COOLDOWN_MS);
    const res = await request(h.app).post('/auth/resend-otp').send({ email: 'ada@example.com' });
    expect(res.status).toBe(200);
    expect(h.outbox).toHaveLength(2);

    const second = h.lastCode();
    expect(second).not.toBe(first);

    const stale = await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code: first });
    expect(stale.status).toBe(400);

    const fresh = await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code: second });
    expect(fresh.status).toBe(200);
  });

  it('gives every send its own dedupe key, so resends are not swallowed', async () => {
    const h = harness();
    await signUp(h);
    h.advance(OTP_RESEND_COOLDOWN_MS);
    await request(h.app).post('/auth/resend-otp').send({ email: 'ada@example.com' });

    const keys = h.outbox.map((m) => m.eventId);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('clears the attempt count, so a burned challenge is recoverable', async () => {
    const h = harness();
    await signUp(h);
    const wrong = h.lastCode() === '000000' ? '111111' : '000000';
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await request(h.app).post('/auth/verify-otp').send({ email: 'ada@example.com', code: wrong });
    }

    h.advance(OTP_RESEND_COOLDOWN_MS);
    await request(h.app).post('/auth/resend-otp').send({ email: 'ada@example.com' });

    const res = await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code: h.lastCode() });
    expect(res.status).toBe(200);
  });

  it('stops at the send ceiling', async () => {
    const h = harness();
    await signUp(h);

    for (let i = 1; i < OTP_MAX_SENDS; i++) {
      h.advance(OTP_RESEND_COOLDOWN_MS);
      const ok = await request(h.app).post('/auth/resend-otp').send({ email: 'ada@example.com' });
      expect(ok.status).toBe(200);
    }
    expect(h.outbox).toHaveLength(OTP_MAX_SENDS);

    h.advance(OTP_RESEND_COOLDOWN_MS);
    const res = await request(h.app).post('/auth/resend-otp').send({ email: 'ada@example.com' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('too_many_sends');
    expect(h.outbox).toHaveLength(OTP_MAX_SENDS);
  });

  it('will not mint a code for an address with nothing pending', async () => {
    const h = harness();

    const res = await request(h.app)
      .post('/auth/resend-otp')
      .send({ email: 'stranger@example.com' });

    // Otherwise this is a way to send mail from our domain to any address
    // anyone types, with no account involved at all.
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('no_challenge');
    expect(h.outbox).toHaveLength(0);
  });
});

// ── what happens when the mail cannot go out ────────────────────────────────

describe('when the code cannot be delivered', () => {
  // The refusal path logs at error level on purpose. Silenced here so a passing
  // run does not scroll FATAL lines that mean nothing -- see docs/TRAPS.md #1.
  let errors: jest.SpyInstance;
  beforeEach(() => {
    errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errors.mockRestore();
  });

  it('refuses the sign-up in production rather than letting it through', async () => {
    const h = harness({
      env: { NODE_ENV: 'production', DEV_AUTH_BYPASS: undefined },
      delivery: () => ({ outcome: 'not_configured' }),
    });

    const res = await signUp(h);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('email_undeliverable');
    expect(res.body.token).toBeUndefined();
    expect(res.body.pending).toBeUndefined();
  });

  it('refuses in production on a transient failure too', async () => {
    const h = harness({
      env: { NODE_ENV: 'production', DEV_AUTH_BYPASS: undefined },
      delivery: () => ({ outcome: 'failed', detail: 'connection refused' }),
    });

    expect((await signUp(h)).status).toBe(503);
  });

  it('logs the code to the console in dev instead, and still never returns it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness({ delivery: () => ({ outcome: 'not_configured' }) });

    const res = await signUp(h);

    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(true);
    const code = h.lastCode();
    expect(warn.mock.calls.flat().join(' ')).toContain(code);
    // The console is the ONLY place it is revealed. A response field would be
    // one misconfigured deploy away from handing out every code.
    expect(JSON.stringify(res.body)).not.toContain(code);
    warn.mockRestore();
  });

  it('leaves the unconfirmed account reclaimable after a production refusal', async () => {
    const h = harness({
      env: { NODE_ENV: 'production', DEV_AUTH_BYPASS: undefined },
      delivery: () => ({ outcome: 'not_configured' }),
    });
    await signUp(h);

    // Two things at once. The account row was written before the send was
    // attempted, so a later signup for the same address must not be refused as
    // "already exists" -- that would permanently burn an address over a mail
    // outage. And the retry must not be rate-limited either: it is answered
    // immediately, with a second attempt to send, rather than "wait 60s" for a
    // code that was never delivered.
    const retry = await signUp(h);
    expect(retry.status).toBe(503);
    expect(retry.body.code).toBe('email_undeliverable');
    expect(retry.body.error).not.toMatch(/already exists/i);
    expect(h.outbox).toHaveLength(2);
  });

  it('recovers cleanly the moment mail starts working again', async () => {
    let deliverable = false;
    const h = harness({
      env: { NODE_ENV: 'production', DEV_AUTH_BYPASS: undefined },
      delivery: () => (deliverable ? { outcome: 'sent' } : { outcome: 'not_configured' }),
    });

    expect((await signUp(h)).status).toBe(503);

    deliverable = true;
    const res = await signUp(h);
    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(true);

    const confirmed = await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code: h.lastCode() });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.token).toBeDefined();
  });
});

// ── signing up over an existing address ─────────────────────────────────────

describe('signing up for an address that is already known', () => {
  it('refuses when the account is confirmed', async () => {
    const h = harness();
    await signUp(h);
    await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code: h.lastCode() });

    const res = await signUp(h, 'ada@example.com', 'a different password');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('reclaims an unconfirmed one, so a mistyped address is not burned forever', async () => {
    const h = harness();
    await signUp(h, 'ada@example.com', 'first attempt');
    h.advance(OTP_RESEND_COOLDOWN_MS);

    const res = await signUp(h, 'ada@example.com', 'second attempt');
    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(true);

    await request(h.app)
      .post('/auth/verify-otp')
      .send({ email: 'ada@example.com', code: h.lastCode() });

    // The password from the second attempt is the one that works — nobody had
    // proved control of the address when the first was written.
    expect(
      (await request(h.app).post('/auth/login').send({ email: 'ada@example.com', password: 'second attempt' }))
        .status,
    ).toBe(200);
    expect(
      (await request(h.app).post('/auth/login').send({ email: 'ada@example.com', password: 'first attempt' }))
        .status,
    ).toBe(401);
  });
});

// ── what is no longer accepted ──────────────────────────────────────────────

describe('sign-up validation', () => {
  // Checklist section 4 line 2: "clear error, no account created". Both halves
  // were false before this — a one-character password and an address of `a@b`
  // each created a real account, and so did one containing a space.
  it.each([
    ['a one-character password', { email: 'ada@example.com', password: 'a' }, 'password_too_short'],
    ['a seven-character password', { email: 'ada@example.com', password: '1234567' }, 'password_too_short'],
    ['an address with no dot', { email: 'a@b', password: 'a good long password' }, 'email_invalid'],
    ['an address with a space', { email: 'a b@example.com', password: 'a good long password' }, 'email_invalid'],
    ['an address with no local part', { email: '@example.com', password: 'a good long password' }, 'email_invalid'],
  ])('refuses %s', async (_label, body, expected) => {
    const h = harness();
    const res = await request(h.app).post('/auth/signup').send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(expected);
    // The half that is easy to forget: nothing was written, and nothing mailed.
    expect(h.users.rows.size).toBe(0);
    expect(h.outbox).toHaveLength(0);
  });

  it('accepts a password of exactly the minimum length', async () => {
    // The boundary in the direction that locks people out, not just the one
    // that lets them in.
    const h = harness();
    const res = await request(h.app)
      .post('/auth/signup')
      .send({ email: 'ada@example.com', password: '12345678' });

    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(true);
  });

  it('leaves existing accounts with short passwords able to log in', async () => {
    // The rule is a SIGN-UP rule. Applying it at login would lock out every
    // account created before it existed, which is the same migration hazard as
    // the emailVerified default.
    const h = harness({
      seed: [
        {
          playerId: 'player-legacy',
          email: 'old@example.com',
          password: 'short',
          displayName: 'Old Timer',
        },
      ],
    });

    const res = await request(h.app)
      .post('/auth/login')
      .send({ email: 'old@example.com', password: 'short' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });
});

describe('phone sign-up', () => {
  it('is refused, rather than creating an account no code can reach', async () => {
    const h = harness();

    const res = await request(h.app)
      .post('/auth/signup')
      .send({ phone: '+15551234567', password: 'whatever' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('email_required');
    expect(h.outbox).toHaveLength(0);
  });

  it('still lets an existing phone account log in', async () => {
    const h = harness({
      seed: [
        {
          playerId: 'player-phone',
          email: '+15551234567',
          password: 'hunter2',
          displayName: 'Phone User',
        },
      ],
    });

    const res = await request(h.app)
      .post('/auth/login')
      .send({ phone: '+15551234567', password: 'hunter2' });

    expect(res.status).toBe(200);
  });
});
