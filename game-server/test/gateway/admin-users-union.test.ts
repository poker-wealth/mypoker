import request from 'supertest';
import { createGatewayApp } from '../../src/gateway/app';
import { loadConfig } from '../../src/gateway/config';
import { signToken } from '../../src/gateway/tokens';
import { userStore } from '../../src/auth/user-store';

/**
 * The admin Users list is the UNION of two populations.
 *
 * It was financial-core's players alone, which is every account money has
 * touched — so a web registration that had never deposited or played did not
 * appear at all. Someone could sign up, fail to get in, contact support, and be
 * told no such account exists. New sign-ups are exactly who support is asked
 * about first, which made the omission worst where it mattered most.
 *
 * The reverse omission is just as real and is why neither source alone will do:
 * Telegram players have no identity document, so the user store would miss
 * them entirely.
 */
jest.mock('../../src/auth/user-store', () => ({
  userStore: {
    listIdentities: jest.fn(),
    byPlayerIds: jest.fn(),
    search: jest.fn(),
    byPlayerId: jest.fn(),
    listAdmins: jest.fn(),
  },
}));

const JWT_SECRET = 'test-secret-union';
const opsToken = signToken({ playerId: 'admin-1', role: 'ops' }, JWT_SECRET, 300);

const app = () =>
  createGatewayApp(
    loadConfig({
      JWT_SECRET,
      NODE_ENV: 'test',
      INTERNAL_API_SECRET: 'shh',
      FINANCIAL_CORE_URL: 'http://financial-core.test',
    } as NodeJS.ProcessEnv),
  );

/** financial-core's answer, stubbed at the fetch boundary. */
function coreReturns(players: unknown[], truncated = false, ok = true): void {
  global.fetch = jest.fn(async () => ({
    ok,
    status: ok ? 200 : 503,
    json: async () => (ok ? { players, truncated } : { error: 'financial service unavailable' }),
  })) as unknown as typeof fetch;
}

const get = () => request(app()).get('/admin/users').set('authorization', `Bearer ${opsToken}`);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /admin/users', () => {
  it('includes a registration that has no financial account yet', async () => {
    // The whole point. This player exists in the user store and financial-core
    // has never heard of them.
    coreReturns([]);
    (userStore.listIdentities as jest.Mock).mockResolvedValue([
      {
        playerId: 'player-new',
        email: 'new@example.com',
        displayName: 'Just Signed Up',
        createdAt: '2026-08-28T10:00:00.000Z',
      },
    ]);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0]).toMatchObject({
      playerId: 'player-new',
      email: 'new@example.com',
      // null, not '0' — no account is a different fact from an empty one, and
      // the table renders the two differently.
      balance: null,
    });
  });

  it('includes a Telegram player who has no identity document', async () => {
    // The other direction: the user store knows nothing about them.
    coreReturns([
      { playerId: 'tg-42', balance: '120.00', available: '120.00', joinedAt: '2026-08-27T00:00:00.000Z' },
    ]);
    (userStore.listIdentities as jest.Mock).mockResolvedValue([]);

    const res = await get();

    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0]).toMatchObject({
      playerId: 'tg-42',
      displayName: null,
      balance: '120.00',
    });
  });

  it('lists a player present in BOTH exactly once, with their balance', async () => {
    coreReturns([
      { playerId: 'p-1', balance: '50.00', available: '50.00', joinedAt: '2026-08-26T00:00:00.000Z' },
    ]);
    (userStore.listIdentities as jest.Mock).mockResolvedValue([
      {
        playerId: 'p-1',
        email: 'both@example.com',
        displayName: 'In Both',
        createdAt: '2026-08-26T00:00:00.000Z',
      },
    ]);

    const res = await get();

    // A union, not a concatenation. Duplicating the common case would be the
    // obvious way to get this wrong and would look fine on a small dataset.
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0]).toMatchObject({
      playerId: 'p-1',
      email: 'both@example.com',
      balance: '50.00',
    });
  });

  it('orders newest first across both sources', async () => {
    coreReturns([
      { playerId: 'old', balance: '1.00', available: '1.00', joinedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    (userStore.listIdentities as jest.Mock).mockResolvedValue([
      { playerId: 'new', displayName: 'Newer', createdAt: '2026-08-28T00:00:00.000Z' },
    ]);

    const res = await get();

    // The merge is only useful if the two interleave by date — an identity-only
    // row appended after every funded player would bury today's sign-ups.
    expect(res.body.users.map((u: { playerId: string }) => u.playerId)).toEqual(['new', 'old']);
  });

  it('fails loudly when financial-core is down, rather than showing a half list', async () => {
    coreReturns([], false, false);
    (userStore.listIdentities as jest.Mock).mockResolvedValue([
      { playerId: 'player-new', displayName: 'Someone', createdAt: '2026-08-28T00:00:00.000Z' },
    ]);

    const res = await get();

    // Serving the identity half with every balance blank would show "no
    // account" against players who hold funds. An admin would act on that.
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.users).toBeUndefined();
  });
});
