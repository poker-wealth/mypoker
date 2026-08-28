import mongoose from 'mongoose';
import { withAuditTransaction } from '../../src/auth/admin-audit-store';

/**
 * The wrapper that makes an admin write and its audit entry atomic.
 *
 * Every write route used to apply the change and then log it, so a failed log
 * left the change live with no record — the one state the audit log exists to
 * make impossible. This closes that, and its own failure modes are what these
 * tests pin: it must not swallow a real error (which would report a rolled-back
 * write as success), and it must not take down every admin write on a
 * deployment without transaction support.
 *
 * `mongoose.startSession` is stubbed. A real replica set here would be testing
 * MongoDB rather than this decision, and this package's tests never connect to
 * a database.
 */
describe('withAuditTransaction', () => {
  const realStartSession = mongoose.startSession.bind(mongoose);

  afterEach(() => {
    (mongoose as unknown as { startSession: unknown }).startSession = realStartSession;
    jest.restoreAllMocks();
  });

  /** A session whose withTransaction behaves as told. */
  function fakeSession(onTransaction?: (fn: () => Promise<void>) => Promise<void>) {
    return {
      withTransaction: jest.fn(async (fn: () => Promise<void>) =>
        onTransaction ? onTransaction(fn) : fn(),
      ),
      endSession: jest.fn(async () => undefined),
    };
  }

  it('runs the body inside a transaction and returns its result', async () => {
    const session = fakeSession();
    (mongoose as unknown as { startSession: unknown }).startSession = jest.fn(async () => session);

    const result = await withAuditTransaction(async (s) => {
      expect(s).toBe(session);
      return 'done';
    });

    expect(result).toBe('done');
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    // Always released, or the connection pool leaks a session per admin write.
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('ends the session even when the body throws', async () => {
    const session = fakeSession();
    (mongoose as unknown as { startSession: unknown }).startSession = jest.fn(async () => session);

    await expect(
      withAuditTransaction(async () => {
        throw new Error('the write failed');
      }),
    ).rejects.toThrow('the write failed');

    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('PROPAGATES a real failure rather than swallowing it', async () => {
    // The dangerous mistake in a fallback like this: catching everything, so a
    // rolled-back write is reported to the administrator as success.
    const session = fakeSession();
    (mongoose as unknown as { startSession: unknown }).startSession = jest.fn(async () => session);

    const body = jest.fn(async () => 'never');
    await expect(
      withAuditTransaction(async () => {
        void body;
        throw new Error('duplicate key');
      }),
    ).rejects.toThrow('duplicate key');
  });

  it('falls back to no session when the deployment has no transaction support', async () => {
    // A standalone mongod rejects with this. Failing every admin write outright
    // would be worse than running without atomicity — but the fallback must be
    // narrow, which is why it matches on the message rather than catching all.
    const session = fakeSession(async () => {
      throw new Error('Transaction numbers are only allowed on a replica set member or mongos');
    });
    (mongoose as unknown as { startSession: unknown }).startSession = jest.fn(async () => session);

    const body = jest.fn(async (s?: unknown) => {
      expect(s).toBeUndefined();
      return 'ran anyway';
    });

    await expect(withAuditTransaction(body)).resolves.toBe('ran anyway');
    // ONCE. This fake rejects before ever invoking the body, which is what a
    // standalone mongod does — it refuses the transaction rather than running
    // it and failing at commit. A real double-execution would be a genuine
    // hazard here (two audit entries for one action), so the count is asserted
    // rather than assumed.
    expect(body).toHaveBeenCalledTimes(1);
  });

  it('falls back when a session cannot be started at all', async () => {
    (mongoose as unknown as { startSession: unknown }).startSession = jest.fn(async () => {
      throw new Error('no connection');
    });

    await expect(withAuditTransaction(async (s) => (s === undefined ? 'ok' : 'bad'))).resolves.toBe(
      'ok',
    );
  });
});
