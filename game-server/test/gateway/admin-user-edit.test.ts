import request from 'supertest';
import { createGatewayApp } from '../../src/gateway/app';
import { loadConfig } from '../../src/gateway/config';
import { signToken } from '../../src/gateway/tokens';
import { userStore } from '../../src/auth/user-store';
import { adminAudit } from '../../src/auth/admin-audit-store';

/**
 * The admin user-edit surface.
 *
 * Both stores are mocked: these tests are about the ROUTE's decisions — who is
 * recorded as the actor, what validation runs, what is refused — not about
 * Mongoose. A real database here would test the driver and hide the logic.
 */
jest.mock('../../src/auth/user-store', () => ({
  userStore: {
    adminGet: jest.fn(),
    adminUpdate: jest.fn(),
    adminSetSuspended: jest.fn(),
    adminSetPassword: jest.fn(),
    byPlayerId: jest.fn(),
    search: jest.fn(),
  },
}));

jest.mock('../../src/auth/admin-audit-store', () => {
  const actual = jest.requireActual('../../src/auth/admin-audit-store');
  return {
    // The real diff — an audit assertion against a mocked differ proves nothing.
    changedFields: actual.changedFields,
    adminAudit: { record: jest.fn(), forSubject: jest.fn() },
    // A passthrough: the real one opens a Mongo session and nothing here
    // connects to a database. Atomicity is asserted in
    // admin-audit-transaction.test.ts; these tests are about route decisions.
    withAuditTransaction: (fn: (s?: unknown) => Promise<unknown>) => fn(undefined),
  };
});

const JWT_SECRET = 'test-secret-admin-edit';
const ADMIN_ID = 'player-admin-1';
const SUBJECT = 'player-subject-1';

const app = () =>
  createGatewayApp(
    loadConfig({
      JWT_SECRET,
      NODE_ENV: 'test',
      FINANCIAL_CORE_URL: 'http://127.0.0.1:9',
    } as NodeJS.ProcessEnv),
  );

const opsToken = signToken({ playerId: ADMIN_ID, role: 'ops' }, JWT_SECRET, 300);
const playerToken = signToken({ playerId: 'player-nobody' , role: 'player' }, JWT_SECRET, 300);

const record = (over: Record<string, unknown> = {}) => ({
  playerId: SUBJECT,
  email: 'sam@example.com',
  phone: null,
  displayName: 'Sam',
  photoUrl: null,
  emailVerified: true,
  role: 'player',
  hasPassword: true,
  hasGoogle: false,
  suspendedAt: null,
  suspendedReason: null,
  suspendedBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the guard covers the write routes too', () => {
  // The read routes were guarded from the start. A new write mounted on the same
  // router inherits that — but "inherits" is an assumption, and this is the
  // surface where being wrong hands an ordinary player every account.
  it.each([
    ['patch', '/admin/players/x'],
    ['post', '/admin/players/x/suspension'],
    ['post', '/admin/players/x/password'],
    ['get', '/admin/players/x/account'],
    ['get', '/admin/players/x/audit'],
  ])('404s a player on %s %s', async (method, path) => {
    const res = await (request(app()) as never as Record<string, (p: string) => request.Test>)[
      method
    ]!(path).set('authorization', `Bearer ${playerToken}`);
    expect(res.status).toBe(404);
  });

  it('401s with no token', async () => {
    const res = await request(app()).patch('/admin/players/x').send({ displayName: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('PATCH /admin/players/:id', () => {
  it('saves a display name and audits it with the actor from the TOKEN', async () => {
    (userStore.adminUpdate as jest.Mock).mockResolvedValue({
      ok: true,
      before: record({ displayName: 'Sam' }),
      after: record({ displayName: 'Samuel' }),
    });

    const res = await request(app())
      .patch(`/admin/players/${SUBJECT}`)
      .set('authorization', `Bearer ${opsToken}`)
      // A body that tries to name someone else as the actor. It must be ignored.
      .send({ displayName: 'Samuel', actorPlayerId: 'player-someone-else' });

    expect(res.status).toBe(200);
    expect(adminAudit.record).toHaveBeenCalledTimes(1);
    const entry = (adminAudit.record as jest.Mock).mock.calls[0]![0];
    expect(entry.actorPlayerId).toBe(ADMIN_ID);
    expect(entry.before).toEqual({ displayName: 'Sam' });
    expect(entry.after).toEqual({ displayName: 'Samuel' });
  });

  it('does not write an audit entry when nothing actually changed', async () => {
    (userStore.adminUpdate as jest.Mock).mockResolvedValue({
      ok: true,
      before: record(),
      after: record(),
    });

    const res = await request(app())
      .patch(`/admin/players/${SUBJECT}`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ displayName: 'Sam' });

    expect(res.status).toBe(200);
    expect(adminAudit.record).not.toHaveBeenCalled();
  });

  it('rejects an invalid email with the same rule sign-up uses', async () => {
    const res = await request(app())
      .patch(`/admin/players/${SUBJECT}`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ email: 'not-an-address' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('email_invalid');
    // Refused before the store was reached — no half-write to undo.
    expect(userStore.adminUpdate).not.toHaveBeenCalled();
  });

  it('rejects an over-long display name', async () => {
    const res = await request(app())
      .patch(`/admin/players/${SUBJECT}`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ displayName: 'x'.repeat(41) });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('display_name_too_long');
  });

  it('marks a changed email UNCONFIRMED unless told otherwise', async () => {
    (userStore.adminUpdate as jest.Mock).mockResolvedValue({
      ok: true,
      before: record(),
      after: record({ email: 'new@example.com', emailVerified: false }),
    });

    await request(app())
      .patch(`/admin/players/${SUBJECT}`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ email: 'new@example.com' });

    // Carrying "confirmed" across an address change would mark an address
    // confirmed that nobody has proved control of — the admin typed it, which
    // is not the same thing.
    const patch = (userStore.adminUpdate as jest.Mock).mock.calls[0]![1];
    expect(patch.emailVerified).toBe(false);
  });

  it('lets an admin override that explicitly', async () => {
    (userStore.adminUpdate as jest.Mock).mockResolvedValue({
      ok: true,
      before: record(),
      after: record({ email: 'new@example.com' }),
    });

    await request(app())
      .patch(`/admin/players/${SUBJECT}`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ email: 'new@example.com', emailVerified: true });

    const patch = (userStore.adminUpdate as jest.Mock).mock.calls[0]![1];
    expect(patch.emailVerified).toBe(true);
  });

  it('409s when the address belongs to someone else', async () => {
    (userStore.adminUpdate as jest.Mock).mockResolvedValue({ ok: false, reason: 'email_taken' });

    const res = await request(app())
      .patch(`/admin/players/${SUBJECT}`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ email: 'taken@example.com' });

    // 409, not 500. A duplicate-key error surfacing as a server fault tells the
    // admin nothing about what to do next.
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('email_taken');
  });

  it('refuses a role that is not one of the three', async () => {
    const res = await request(app())
      .patch(`/admin/players/${SUBJECT}`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ role: 'superuser' });

    expect(res.status).toBe(400);
    expect(userStore.adminUpdate).not.toHaveBeenCalled();
  });
});

describe('POST /admin/players/:id/suspension', () => {
  it('suspends, naming the acting admin from the token', async () => {
    (userStore.adminSetSuspended as jest.Mock).mockResolvedValue({
      before: record(),
      after: record({ suspendedAt: '2026-02-01T00:00:00.000Z', suspendedReason: 'fraud' }),
    });

    const res = await request(app())
      .post(`/admin/players/${SUBJECT}/suspension`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ suspended: true, reason: 'fraud' });

    expect(res.status).toBe(200);
    const args = (userStore.adminSetSuspended as jest.Mock).mock.calls[0];
    expect(args![2]).toBe(ADMIN_ID);
    expect((adminAudit.record as jest.Mock).mock.calls[0]![0].action).toBe('user.suspend');
  });

  it('refuses to let an admin suspend themselves', async () => {
    // Otherwise the panel is locked behind an account that can no longer sign
    // in to unlock it, and the only way back is shell access to the server.
    const res = await request(app())
      .post(`/admin/players/${ADMIN_ID}/suspension`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ suspended: true, reason: 'oops' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('self_suspend');
    expect(userStore.adminSetSuspended).not.toHaveBeenCalled();
  });

  it('allows reinstating yourself, which is not the dangerous direction', async () => {
    (userStore.adminSetSuspended as jest.Mock).mockResolvedValue({
      before: record({ suspendedAt: '2026-02-01T00:00:00.000Z' }),
      after: record(),
    });

    const res = await request(app())
      .post(`/admin/players/${ADMIN_ID}/suspension`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ suspended: false });

    expect(res.status).toBe(200);
    expect((adminAudit.record as jest.Mock).mock.calls[0]![0].action).toBe('user.reinstate');
  });

  it('requires a boolean, not a truthy string', async () => {
    const res = await request(app())
      .post(`/admin/players/${SUBJECT}/suspension`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ suspended: 'false' });

    // 'false' is a truthy string. Accepting it would suspend an account while
    // the admin believed they were lifting one.
    expect(res.status).toBe(400);
    expect(userStore.adminSetSuspended).not.toHaveBeenCalled();
  });
});

describe('POST /admin/players/:id/password', () => {
  it('sets a password and never records what it was', async () => {
    (userStore.adminSetPassword as jest.Mock).mockResolvedValue({ ok: true });

    const res = await request(app())
      .post(`/admin/players/${SUBJECT}/password`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ newPassword: 'a-good-long-password', reason: 'locked out of email' });

    expect(res.status).toBe(200);

    // The audit entry proves WHO and WHEN. Putting the value in a collection
    // built to be read by people would be handing out a live credential.
    const entry = (adminAudit.record as jest.Mock).mock.calls[0]![0];
    expect(entry.action).toBe('user.set_password');
    expect(entry.actorPlayerId).toBe(ADMIN_ID);
    expect(JSON.stringify(entry)).not.toContain('a-good-long-password');
    // And it is not echoed back to the caller either.
    expect(JSON.stringify(res.body)).not.toContain('a-good-long-password');
  });

  it('applies the same length rule as self-service', async () => {
    const res = await request(app())
      .post(`/admin/players/${SUBJECT}/password`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('password_too_short');
    expect(userStore.adminSetPassword).not.toHaveBeenCalled();
  });
});

describe('GET /admin/players/:id/account', () => {
  it('explains a Telegram player rather than erroring', async () => {
    (userStore.adminGet as jest.Mock).mockResolvedValue(null);

    const res = await request(app())
      .get(`/admin/players/${SUBJECT}/account`)
      .set('authorization', `Bearer ${opsToken}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('no_identity');
    expect(res.body.note).toMatch(/Telegram/);
  });

  it('never returns a password hash', async () => {
    (userStore.adminGet as jest.Mock).mockResolvedValue(record());

    const res = await request(app())
      .get(`/admin/players/${SUBJECT}/account`)
      .set('authorization', `Bearer ${opsToken}`);

    expect(res.status).toBe(200);
    expect(res.body.hasPassword).toBe(true);
    expect(res.body.passwordHash).toBeUndefined();
  });
});
