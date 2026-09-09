import request from 'supertest';
import { createGatewayApp } from '../../src/gateway/app';
import { loadConfig } from '../../src/gateway/config';
import { signToken } from '../../src/gateway/tokens';
import { overrideStore } from '../../src/players/override-store';
import { userStore } from '../../src/auth/user-store';
import { adminAudit } from '../../src/auth/admin-audit-store';
import { MIN_SCORE, MAX_SCORE } from '../../src/players/reputation';

/**
 * Overriding a DERIVED value — reputation score, VIP tier.
 *
 * The owner asked for these to be editable. They are computed from facts the
 * ledger owns, so the whole design question was what "editable" means: rewrite
 * the facts, or record a decision beside them. This is the second, and these
 * tests pin the properties that make it defensible — the override is bounded,
 * always attributable, always reversible, and never touches the history.
 */
jest.mock('../../src/players/override-store', () => ({
  overrideStore: { get: jest.fn(), set: jest.fn(), clearCache: jest.fn() },
}));

// The player-exists check consults the user store as its second source, so it
// has to be mocked here — unmocked, it reaches a real Mongoose with no
// connection and the request hangs on a buffered query rather than failing.
jest.mock('../../src/auth/user-store', () => ({
  userStore: { byPlayerId: jest.fn(), search: jest.fn(), listIdentities: jest.fn() },
}));

jest.mock('../../src/auth/admin-audit-store', () => {
  const actual = jest.requireActual('../../src/auth/admin-audit-store');
  return {
    changedFields: actual.changedFields,
    adminAudit: { record: jest.fn(), forSubject: jest.fn() },
    // A PASSTHROUGH, not the real thing: the real one opens a Mongo session and
    // this package's tests never connect to a database. These tests are about
    // the route's decisions — validation, the actor, what reaches the audit
    // entry — not about whether the commit is atomic. That property needs a
    // real replica set and is asserted separately in admin-audit-transaction.
    withAuditTransaction: (fn: (s?: unknown) => Promise<unknown>) => fn(undefined),
  };
});

const JWT_SECRET = 'test-secret-override';
const ADMIN = 'player-admin-1';
const SUBJECT = 'player-subject-1';
const opsToken = signToken({ playerId: ADMIN, role: 'ops' }, JWT_SECRET, 300);
const playerToken = signToken({ playerId: 'nobody', role: 'player' }, JWT_SECRET, 300);

const app = () =>
  createGatewayApp(
    loadConfig({
      JWT_SECRET,
      NODE_ENV: 'test',
      FINANCIAL_CORE_URL: 'http://127.0.0.1:9',
    } as NodeJS.ProcessEnv),
  );

const post = (body: Record<string, unknown>, token = opsToken) =>
  request(app())
    .post(`/admin/players/${SUBJECT}/override`)
    .set('authorization', `Bearer ${token}`)
    .send(body);

beforeEach(() => {
  jest.clearAllMocks();
  // financial-core confirms the player exists. Stubbed at the fetch boundary,
  // the same seam the union test uses.
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ playerId: SUBJECT, hasAccount: true }),
  })) as unknown as typeof fetch;
  (overrideStore.set as jest.Mock).mockResolvedValue({
    before: null,
    after: { reputationScore: 80, vipTier: null, setBy: ADMIN, reason: 'goodwill', at: 'now' },
  });
});

describe('POST /admin/players/:id/override', () => {
  it('404s an ordinary player, like every other admin route', async () => {
    const res = await post({ reputationScore: 80, reason: 'x' }, playerToken);
    expect(res.status).toBe(404);
  });

  it('REQUIRES a reason', async () => {
    // Every other admin write treats the reason as optional. This one cannot:
    // an override has no round, settlement or deposit behind it, so the
    // sentence an administrator writes is the only evidence the number will
    // ever have.
    const res = await post({ reputationScore: 80 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('reason_required');
    expect(overrideStore.set).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only reason', async () => {
    const res = await post({ reputationScore: 80, reason: '   ' });
    expect(res.status).toBe(400);
    expect(overrideStore.set).not.toHaveBeenCalled();
  });

  it('sets a reputation score and audits it with the actor from the token', async () => {
    const res = await post({ reputationScore: 80, reason: 'goodwill after a support case' });

    expect(res.status).toBe(200);
    expect(overrideStore.set).toHaveBeenCalledWith(
      SUBJECT,
      { reputationScore: 80 },
      ADMIN, // from the verified token, never the body
      'goodwill after a support case',
      // The transaction session. `undefined` here because the mocked
      // `withAuditTransaction` is a passthrough — in production this is a real
      // session and the write is atomic with its audit entry.
      undefined,
    );
    const entry = (adminAudit.record as jest.Mock).mock.calls[0]![0];
    expect(entry.action).toBe('user.override');
    expect(entry.actorPlayerId).toBe(ADMIN);
    expect(entry.reason).toBe('goodwill after a support case');
  });

  it.each([[-1], [1001], [3.5], ['800']])('rejects an out-of-range score: %p', async (value) => {
    // Bounded by MIN_SCORE/MAX_SCORE, which are 0 and 1000 — reputation is a
    // 0–1000 scale (v5.9 §10.1). This test originally asserted 0–100, a bound
    // invented at the keyboard, and would have locked in a bug where every
    // legitimate value was rejected.
    const res = await post({ reputationScore: value, reason: 'x' });
    expect(res.status).toBe(400);
    expect(overrideStore.set).not.toHaveBeenCalled();
  });

  it.each([[MIN_SCORE], [700], [MAX_SCORE]])('accepts a score in range: %p', async (value) => {
    // The half that catches a bound set too NARROW. Only testing rejection
    // would have passed happily against 0–100 while refusing every real score.
    const res = await post({ reputationScore: value, reason: 'in range' });
    expect(res.status).toBe(200);
  });

  it('rejects a VIP tier that does not exist', async () => {
    // 'V9' would pass a cast and then throw inside vipSpec, which indexes the
    // ladder by position.
    const res = await post({ vipTier: 'V9', reason: 'x' });
    expect(res.status).toBe(400);
    expect(overrideStore.set).not.toHaveBeenCalled();
  });

  it('accepts a real tier', async () => {
    const res = await post({ vipTier: 'V4', reason: 'partner account' });
    expect(res.status).toBe(200);
    expect(overrideStore.set).toHaveBeenCalledWith(
      SUBJECT,
      { vipTier: 'V4' },
      ADMIN,
      'partner account',
      undefined,
    );
  });

  it('clears with null, returning the player to their computed values', async () => {
    (overrideStore.set as jest.Mock).mockResolvedValue({
      before: { reputationScore: 80, vipTier: 'V4', setBy: ADMIN, reason: 'old', at: 'then' },
      after: null,
    });

    const res = await post({ reputationScore: null, vipTier: null, reason: 'no longer applies' });

    expect(res.status).toBe(200);
    // Nothing about this is destructive — the computed value was never
    // overwritten, only shadowed.
    expect(res.body.reputationScore).toBeNull();
    expect(res.body.vipTier).toBeNull();
  });

  it('refuses an override for a player who does not exist', async () => {
    // A typo'd id would otherwise write an override keyed to nobody — inert
    // today, and silently applied if that id ever became a real player.
    //
    // `ok: true` with `hasAccount: false` — NOT a 404. That is what
    // financial-core actually answers for an unknown id, and an earlier version
    // of both the guard and this test waited for a 404 that route never sends,
    // so the check passed for every id including nonsense.
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ playerId: SUBJECT, hasAccount: false }),
    })) as unknown as typeof fetch;
    // Unknown to the user store as well: no financial account AND no identity
    // is what "does not exist" means. Either one alone is an ordinary account.
    (userStore.byPlayerId as jest.Mock).mockResolvedValue(null);

    const res = await post({ reputationScore: 800, reason: 'typo' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('no_such_player');
    expect(overrideStore.set).not.toHaveBeenCalled();
  });

  it('ALLOWS an override for a registered player who has never touched money', async () => {
    // The other half, and the reason `hasAccount: false` alone cannot refuse: a
    // web sign-up has no financial account until money moves, and refusing them
    // would exclude every player who has registered and not yet deposited.
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ playerId: SUBJECT, hasAccount: false }),
    })) as unknown as typeof fetch;
    (userStore.byPlayerId as jest.Mock).mockResolvedValue({
      playerId: SUBJECT,
      displayName: 'Registered, never played',
    });

    const res = await post({ reputationScore: 800, reason: 'goodwill' });

    expect(res.status).toBe(200);
    expect(overrideStore.set).toHaveBeenCalled();
  });

  it('does NOT report a financial-core outage as "no such player"', async () => {
    // The distinction that matters to the admin reading it: one means "you have
    // the wrong id, go and find the right one", the other means "try again
    // later". Collapsing them sends someone hunting for an id that was correct.
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'financial service unavailable' }),
    })) as unknown as typeof fetch;

    const res = await post({ reputationScore: 800, reason: 'x' });

    expect(res.status).not.toBe(404);
    expect(res.body.code).toBeUndefined();
    expect(overrideStore.set).not.toHaveBeenCalled();
  });

  it('refuses a request that would change nothing', async () => {
    const res = await post({ reason: 'just because' });
    expect(res.status).toBe(400);
    expect(overrideStore.set).not.toHaveBeenCalled();
  });

  it('records the previous values in the audit entry', async () => {
    (overrideStore.set as jest.Mock).mockResolvedValue({
      before: { reputationScore: 20, vipTier: null, setBy: 'someone', reason: 'old', at: 'then' },
      after: { reputationScore: 90, vipTier: null, setBy: ADMIN, reason: 'new', at: 'now' },
    });

    await post({ reputationScore: 90, reason: 'new' });

    // What it used to be is the whole point of the entry — an override raised
    // from 20 to 90 is a very different act from one set on a fresh account.
    const entry = (adminAudit.record as jest.Mock).mock.calls[0]![0];
    expect(entry.before.reputationScore).toBe(20);
    expect(entry.after.reputationScore).toBe(90);
  });
});
