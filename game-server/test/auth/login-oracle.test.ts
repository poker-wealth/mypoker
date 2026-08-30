import { userStore, LoginError, SignupError } from '../../src/auth/user-store';
import { UserModel } from '../../src/auth/user.model';

/**
 * [security] /auth/login must not tell an unauthenticated caller who banks here.
 *
 * An earlier revision answered `no_account` for an unknown identifier and
 * `wrong_password` for a known one. That is an account-enumeration oracle: feed
 * in a list of addresses, keep the ones that come back `wrong_password`, and
 * aim every later attempt at accounts you know exist. On a platform holding
 * money that list is worth having on its own.
 *
 * These tests are the thing that stops it coming back. The refusal is easy to
 * "improve" later — telling a user which field to fix is genuinely nicer — and
 * nothing else in the suite would notice.
 *
 * The store is exercised for real; only the Mongoose model is faked, because
 * the property under test lives in the branching of `verifyCredentials`, not in
 * the database.
 */

jest.mock('../../src/auth/user.model', () => ({
  UserModel: { findOne: jest.fn(), create: jest.fn() },
}));

const findOne = UserModel.findOne as unknown as jest.Mock;

/** `findByIdentifier` calls `.lean()` on the query. */
const resolvesTo = (doc: unknown): void => {
  findOne.mockReturnValue({ lean: () => Promise.resolve(doc) });
};

// A real bcrypt hash of 'correct-horse', so compare() does its true work.
const KNOWN_HASH = '$2b$10$WVwlPF9qY2ut2wSUJ4vaxeNEZIpLVkWXOcvuNQduPlkdo8thZi6A2';

const PASSWORD_ACCOUNT = {
  _id: 'u1',
  email: 'someone@example.com',
  passwordHash: KNOWN_HASH,
  displayName: 'Someone',
};

/** Google accounts carry no password hash at all — that is what marks them. */
const GOOGLE_ACCOUNT = { _id: 'u2', email: 'google@example.com', displayName: 'Goo' };

beforeEach(() => {
  findOne.mockReset();
});

async function refusal(identifier: string, password: string): Promise<LoginError> {
  try {
    await userStore.verifyPassword(identifier, password);
  } catch (err) {
    if (err instanceof LoginError) return err;
    throw err;
  }
  throw new Error('expected the sign-in to be refused, but it succeeded');
}

describe('login refusals do not reveal whether an account exists', () => {
  it('answers identically for an unknown identifier and a wrong password', async () => {
    resolvesTo(null);
    const unknown = await refusal('nobody@example.com', 'whatever');

    resolvesTo(PASSWORD_ACCOUNT);
    const wrongPassword = await refusal('someone@example.com', 'not-the-password');

    // Both halves, because either one alone is enough to rebuild the oracle:
    // the code is what the app switches on, the message is what a human reads
    // off the wire.
    expect(unknown.code).toBe('invalid_credentials');
    expect(wrongPassword.code).toBe('invalid_credentials');
    expect(unknown.message).toBe(wrongPassword.message);
  });

  it('does not name which field was wrong', async () => {
    resolvesTo(PASSWORD_ACCOUNT);
    const err = await refusal('someone@example.com', 'not-the-password');
    // "Incorrect password" would confirm the account exists just as loudly as
    // a dedicated code would.
    expect(err.message).not.toMatch(/^Incorrect password$/i);
    expect(err.message).not.toMatch(/no account|not found|does not exist/i);
  });

  it('still lets a correct password through', async () => {
    resolvesTo(PASSWORD_ACCOUNT);
    const identity = await userStore.verifyPassword('someone@example.com', 'correct-horse');
    expect(identity.playerId).toBeTruthy();
  });

  /**
   * Merging the codes is only half the fix. Skipping bcrypt when the account is
   * absent answers in microseconds where a wrong password costs a full 10-round
   * hash, and that gap rebuilds the oracle from timing alone. Both paths must
   * do the work.
   *
   * Asserted as a ratio rather than an absolute, since the hash cost varies by
   * machine: an early return is orders of magnitude faster, not 20% faster, so
   * this catches the regression without being a stopwatch test.
   */
  it('spends comparable time whether or not the account exists', async () => {
    const time = async (fn: () => Promise<unknown>): Promise<number> => {
      const start = process.hrtime.bigint();
      await fn();
      return Number(process.hrtime.bigint() - start) / 1e6;
    };

    resolvesTo(PASSWORD_ACCOUNT);
    const present = await time(() => refusal('someone@example.com', 'not-the-password'));

    resolvesTo(null);
    const absent = await time(() => refusal('nobody@example.com', 'not-the-password'));

    // A short-circuit would put `absent` near zero against ~100ms for `present`.
    expect(absent).toBeGreaterThan(present / 5);
  });
});

describe('the two doors agree', () => {
  it('a Google account is told to use Google at BOTH login and signup', async () => {
    resolvesTo(GOOGLE_ACCOUNT);
    const login = await refusal('google@example.com', 'anything');
    expect(login.code).toBe('use_google');

    resolvesTo(GOOGLE_ACCOUNT);
    let signup: SignupError | undefined;
    try {
      await userStore.signup('google@example.com', 'anything');
    } catch (err) {
      if (err instanceof SignupError) signup = err;
      else throw err;
    }
    // If signup said "already exists" here while login said "use Google", the
    // disagreement between the two endpoints would itself be the information.
    expect(signup?.code).toBe('use_google');
  });

  /**
   * The residual, pinned so it is not mistaken for closed.
   *
   * Signup still confirms that a password account exists, because refusing a
   * duplicate IS that confirmation — there is no wording that both refuses and
   * withholds the reason. Closing it means not answering synchronously at all:
   * accept, send a verification mail, let the mailbox owner find out. That is
   * the email-OTP work, not this PR.
   */
  it('signup still admits a password account exists — known, and not closable here', async () => {
    resolvesTo(PASSWORD_ACCOUNT);
    let code: string | undefined;
    try {
      await userStore.signup('someone@example.com', 'anything');
    } catch (err) {
      if (err instanceof SignupError) code = err.code;
      else throw err;
    }
    expect(code).toBe('account_exists');
  });
});
