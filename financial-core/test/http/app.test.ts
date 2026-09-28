import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Decimal128 } from 'bson';
import { createApp } from '../../src/http/app';
import { signToken } from '../../src/http/jwt';
import { AccountModel } from '../../src/wallet/account.model';
import { PLATFORM_SCOPE } from '../../src/domain/account-types';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { SecurityLogModel } from '../../src/security/security-log.model';
import { SettlementModel } from '../../src/settlement/settlement.model';
import { WithdrawalModel } from '../../src/withdrawal/withdrawal.model';
import { OFFICIAL_USDT_TRC20_CONTRACT } from '../../src/deposit/trc20';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

const INTERNAL_SECRET = 'test-internal-secret';
const JWT_SECRET = 'test-jwt-secret';
// A real, checksum-valid TRON address — /me/withdrawals now rejects malformed ones (§3.6 address
// hygiene) before any state is created, so the old placeholder 'TXaddr' can no longer be used.
const VALID_ADDRESS = 'TYgJ95nhTefUuoTYxEHvVCrfYvroGrSuSU';

let server: Server;
let base: string;

function url(path: string): string {
  return `${base}${path}`;
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const internal = { 'x-internal-secret': INTERNAL_SECRET };
const playerToken = (playerId: string): Record<string, string> => ({
  authorization: `Bearer ${signToken({ playerId, role: 'player' }, JWT_SECRET)}`,
});

describe('Financial Core HTTP API (/api/v1)', () => {
  beforeAll(async () => {
    process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    process.env.JWT_SECRET = JWT_SECRET;
    // Disable the 48h address cooldown for the API tests: they register an address and withdraw to it
    // in the same run. The cooldown itself is covered directly in withdrawal-address.test.ts.
    process.env.WITHDRAWAL_ADDRESS_COOLDOWN_MS = '0';
    await startTestDb();
    await ensureIndexes(
      AccountModel,
      LedgerModel,
      SecurityLogModel,
      SettlementModel,
      WithdrawalModel,
    );
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}/api/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await stopTestDb();
  });

  afterEach(clearCollections);

  it('health is open', async () => {
    const res = await fetch(url('/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  it('serves the OpenAPI spec (the API docs release link)', async () => {
    const res = await fetch(url('/openapi.json'));
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toBe('3.0.3');
    expect(Object.keys(spec.paths)).toContain('/internal/settlements');
  });

  it('rejects internal endpoints without the shared secret (401)', async () => {
    const res = await post('/internal/buy-ins', { playerAccountId: 'x', amount: '1' });
    expect(res.status).toBe(401);
  });

  it('rejects player endpoints without a valid token (401)', async () => {
    expect((await fetch(url('/me/balance'))).status).toBe(401);
    const bad = await fetch(url('/me/balance'), { headers: { authorization: 'Bearer not.a.jwt' } });
    expect(bad.status).toBe(401);
  });

  it('end-to-end: deposit (internal) → balance (player) → withdraw (player)', async () => {
    // Deposit 500 for player p-api via the internal endpoint.
    const dep = await post(
      '/internal/deposits',
      {
        playerId: 'p-api',
        amount: '500',
        txHash: 'tx-api-1',
        contractAddress: OFFICIAL_USDT_TRC20_CONTRACT,
        confirmations: 20,
      },
      internal,
    );
    expect(dep.status).toBe(200);
    expect(await dep.json()).toEqual({ credited: true });

    // Player reads their own balance (scope from JWT).
    const balRes = await fetch(url('/me/balance'), { headers: playerToken('p-api') });
    expect(balRes.status).toBe(200);
    expect(await balRes.json()).toMatchObject({ playerId: 'p-api', available: '500.000000' });

    // Player registers a withdrawal address (§3.6 — payouts go only to the registered address), then
    // requests a withdrawal to it. Cooldown is disabled above, so it is withdrawable immediately.
    const reg = await post('/me/withdrawal-address', { address: VALID_ADDRESS }, playerToken('p-api'));
    expect(reg.status).toBe(200);
    const wRes = await post('/me/withdrawals', { amount: '200', address: VALID_ADDRESS }, playerToken('p-api'));
    expect(wRes.status).toBe(201);
    expect(await wRes.json()).toMatchObject({ state: 'REQUESTED' });
  });

  it('a player can only ever see their own scope (leagueId/ids come from the token, not the body)', async () => {
    await post(
      '/internal/deposits',
      {
        playerId: 'alice',
        amount: '100',
        txHash: 'tx-alice',
        contractAddress: OFFICIAL_USDT_TRC20_CONTRACT,
        confirmations: 20,
      },
      internal,
    );
    // Bob's token only ever resolves to Bob's (empty) account, regardless of any body.
    const res = await fetch(url('/me/balance'), { headers: playerToken('bob') });
    expect(await res.json()).toMatchObject({ playerId: 'bob', available: '0.000000' });
  });

  it('validates request bodies (400) and overdraft (409)', async () => {
    const bad = await post('/internal/buy-ins', { playerAccountId: 'x' }, internal); // missing amount
    expect(bad.status).toBe(400);

    // Overdraft withdrawal → 409. Register the address first so the request passes the §3.6 address
    // gate and reaches the balance check (the point under test) rather than being rejected at 400.
    await post('/me/withdrawal-address', { address: VALID_ADDRESS }, playerToken('broke'));
    const res = await post('/me/withdrawals', { amount: '999', address: VALID_ADDRESS }, playerToken('broke'));
    expect(res.status).toBe(409);
  });

  it('runs the internal settlement endpoint', async () => {
    // Fund a winner account directly, create treasury + jackpot pools, then settle. The settlement
    // route resolves the winner by playerId (owner_id) → account, so the body passes 'w', not the _id.
    await AccountModel.create({
      accountType: 'PLAYER',
      ownerId: 'w',
      availableBalance: Decimal128.fromString('1000'),
    });
    await AccountModel.create({ accountType: 'TREASURY', ownerId: 'PLATFORM' });
    // _id follows the real `jp:<table>:<tier>` shape so /internal/settlements' `jackpotPoolOwner`
    // (BUG-05 follow-up) derives the same owner ('t') these accounts already carry — a mismatched
    // shape here would make ensureJackpotAccounts see a genuine id conflict, not this table's pools.
    const pools = {
      mini: (await AccountModel.create({ _id: 'jp:t:mini', accountType: 'JACKPOT_MINI', ownerId: 't' }))._id,
      minor: (await AccountModel.create({ _id: 'jp:t:minor', accountType: 'JACKPOT_MINOR', ownerId: 't' }))._id,
      major: (await AccountModel.create({ _id: 'jp:t:major', accountType: 'JACKPOT_MAJOR', ownerId: 't' }))._id,
      grand: (await AccountModel.create({ _id: 'jp:t:grand', accountType: 'JACKPOT_GRAND', ownerId: 't' }))._id,
    };
    const res = await post(
      '/internal/settlements',
      {
        roundId: 'r-api-1',
        tableType: 'PLATFORM',
        winnerAccountId: 'w',
        winnerProfit: '1000',
        rake: '50',
        jackpotAccounts: pools,
      },
      internal,
    );
    expect(res.status).toBe(200);
    const receipt = (await res.json()) as { sequence: string[]; hash: string };
    expect(receipt.sequence).toEqual(['jackpot_inject', 'rake', 'payout']);
    expect(receipt.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  // BUG-05 follow-up: /internal/table-settlements provisions a fresh table's jackpot pool accounts
  // before crediting them (ensureJackpotAccounts); /internal/settlements (singular, round-settlement)
  // skipped that step, so a brand-new table's FIRST single-leg settlement crashed with
  // AccountNotFoundError instead of provisioning the pools the way table-settlements already does.
  // Unlike the test above, this one does NOT pre-create the pool accounts — that is what a real
  // fresh table's first hand looks like.
  it('provisions jackpot pool accounts on a fresh table before /internal/settlements settles it', async () => {
    const TABLE = 'r-api-fresh-table';
    await AccountModel.create({
      accountType: 'PLAYER',
      ownerId: 'w-fresh',
      availableBalance: Decimal128.fromString('1000'),
    });
    const pools = {
      mini: `jp:${TABLE}:mini`,
      minor: `jp:${TABLE}:minor`,
      major: `jp:${TABLE}:major`,
      grand: `jp:${TABLE}:grand`,
    };
    const res = await post(
      '/internal/settlements',
      {
        roundId: 'r-api-fresh-1',
        tableType: 'PLATFORM',
        winnerAccountId: 'w-fresh',
        winnerProfit: '1000',
        rake: '50',
        jackpotAccounts: pools,
      },
      internal,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ hash: expect.any(String) });

    expect(await AccountModel.countDocuments({ ownerId: TABLE })).toBe(4);
    const mini = await AccountModel.findById(pools.mini).lean();
    expect(mini?.accountType).toBe('JACKPOT_MINI');
  });

  it('settles a full table hand via /internal/table-settlements', async () => {
    const mk = async (owner: string, lockedAmt: string): Promise<string> =>
      (
        await AccountModel.create({
          accountType: 'PLAYER',
          ownerId: owner,
          lockedBalance: Decimal128.fromString(lockedAmt),
        })
      )._id;
    // Fund each seat's locked balance; the route resolves parties by playerId (owner_id) → account,
    // so the body passes the owner ids ('tp0'/'tp1'), not the account _ids.
    await mk('tp0', '1000');
    await mk('tp1', '1000');
    await AccountModel.create({ accountType: 'TREASURY', ownerId: 'PLATFORM' });
    // _id follows the real `jp:<table>:<tier>` shape so `jackpotPoolOwner` derives the same owner
    // ('tt') these accounts already carry, instead of reading a genuine id conflict (BUG-05 follow-up).
    const pool = async (t: string, tier: string): Promise<string> =>
      (await AccountModel.create({ _id: `jp:tt:${tier}`, accountType: t, ownerId: 'tt' }))._id;

    const res = await post(
      '/internal/table-settlements',
      {
        roundId: 'rt-1',
        tableType: 'PLATFORM',
        losers: [{ playerAccountId: 'tp1', amount: '1000' }],
        winners: [{ playerAccountId: 'tp0', amount: '950' }],
        rake: '50',
        jackpot: { mini: '0', minor: '0', major: '0', grand: '0' },
        jackpotAccounts: {
          mini: await pool('JACKPOT_MINI', 'mini'),
          minor: await pool('JACKPOT_MINOR', 'minor'),
          major: await pool('JACKPOT_MAJOR', 'major'),
          grand: await pool('JACKPOT_GRAND', 'grand'),
        },
      },
      internal,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ roundId: 'rt-1', applied: true });
  });

  // BUG-02: a league table's buy-in/release used to lock and unlock the PLATFORM wallet while
  // settlement resolved the LEAGUE wallet — the account settlement debited was never the one the
  // buy-in locked. tableType/leagueId on buy-ins must route to the SAME account settlement uses.
  it('a LEAGUE buy-in locks the league wallet, and settlement debits that same account — the platform wallet is never touched', async () => {
    const player = 'league-player-1';
    const winner = 'league-player-2';
    const leagueId = 'lg-scope-test';

    // Seed each player's LEAGUE-scoped wallet directly (there is no league deposit path) and a
    // PLATFORM-scoped wallet for the same playerId, so a mistaken PLATFORM lock/debit is visible.
    await AccountModel.create({
      accountType: 'PLAYER', ownerId: player, scope: leagueId,
      availableBalance: Decimal128.fromString('1000'),
    });
    await AccountModel.create({
      accountType: 'PLAYER', ownerId: player, scope: PLATFORM_SCOPE,
      availableBalance: Decimal128.fromString('1000'),
    });
    await AccountModel.create({
      accountType: 'PLAYER', ownerId: winner, scope: leagueId,
      availableBalance: Decimal128.fromString('1000'),
    });

    const buyIn = await post(
      '/internal/buy-ins',
      { playerAccountId: player, amount: '200', tableType: 'LEAGUE', leagueId },
      internal,
    );
    expect(buyIn.status).toBe(200);
    const winnerBuyIn = await post(
      '/internal/buy-ins',
      { playerAccountId: winner, amount: '200', tableType: 'LEAGUE', leagueId },
      internal,
    );
    expect(winnerBuyIn.status).toBe(200);

    const leagueAcctAfterBuyIn = await AccountModel.findOne({ accountType: 'PLAYER', ownerId: player, scope: leagueId }).lean();
    expect(parseFloat(leagueAcctAfterBuyIn!.lockedBalance.toString())).toBe(200);
    expect(parseFloat(leagueAcctAfterBuyIn!.availableBalance.toString())).toBe(800);
    const platformAcctAfterBuyIn = await AccountModel.findOne({ accountType: 'PLAYER', ownerId: player, scope: PLATFORM_SCOPE }).lean();
    expect(parseFloat(platformAcctAfterBuyIn!.lockedBalance.toString())).toBe(0); // untouched by the LEAGUE buy-in
    expect(parseFloat(platformAcctAfterBuyIn!.availableBalance.toString())).toBe(1000);

    // _id follows the real `jp:<table>:<tier>` shape so `jackpotPoolOwner` derives the same owner
    // ('lg-scope-test-table') these accounts already carry (BUG-05 follow-up).
    const pool = async (t: string, tier: string): Promise<string> =>
      (await AccountModel.create({ _id: `jp:lg-scope-test-table:${tier}`, accountType: t, ownerId: 'lg-scope-test-table' }))._id;
    const settle = await post(
      '/internal/table-settlements',
      {
        roundId: 'rt-league-scope-1',
        tableType: 'LEAGUE',
        leagueId,
        losers: [{ playerAccountId: player, amount: '200' }],
        winners: [{ playerAccountId: winner, amount: '190' }],
        rake: '10',
        jackpot: { mini: '0', minor: '0', major: '0', grand: '0' },
        jackpotAccounts: {
          mini: await pool('JACKPOT_MINI', 'mini'),
          minor: await pool('JACKPOT_MINOR', 'minor'),
          major: await pool('JACKPOT_MAJOR', 'major'),
          grand: await pool('JACKPOT_GRAND', 'grand'),
        },
      },
      internal,
    );
    expect(settle.status).toBe(200);
    expect(await settle.json()).toMatchObject({ roundId: 'rt-league-scope-1', applied: true });

    // The LOCKED league balance is what settlement debited: the loser's stake left the league wallet.
    const leagueAcctAfterSettle = await AccountModel.findOne({ accountType: 'PLAYER', ownerId: player, scope: leagueId }).lean();
    expect(parseFloat(leagueAcctAfterSettle!.lockedBalance.toString())).toBe(0);
    // The platform wallet for the same playerId never moved, before or after settlement.
    const platformAcctAfterSettle = await AccountModel.findOne({ accountType: 'PLAYER', ownerId: player, scope: PLATFORM_SCOPE }).lean();
    expect(parseFloat(platformAcctAfterSettle!.availableBalance.toString())).toBe(1000);
    expect(parseFloat(platformAcctAfterSettle!.lockedBalance.toString())).toBe(0);
  });

  /**
   * The roster is the membership list of a private club. A league can be
   * invite-only precisely so that who is in it is not public, so this route is
   * the one league read that is NOT open — and the refusal has to be shaped so
   * it cannot be used to probe for private leagues.
   */
  describe('GET /leagues/:leagueId/members', () => {
    const OWNER = 'tg-roster-owner';
    const MEMBER = 'tg-roster-member';
    const OUTSIDER = 'tg-roster-outsider';

    async function seedLeague(): Promise<void> {
      await post('/leagues', { leagueId: 'lg-roster', name: 'Roster Test' }, playerToken(OWNER));
      await post('/leagues/lg-roster/join', {}, playerToken(MEMBER));
    }

    it('gives a member the roster', async () => {
      await seedLeague();
      const res = await fetch(url('/leagues/lg-roster/members'), {
        headers: playerToken(MEMBER),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { members: { playerId: string; role: string }[] };
      expect(body.members.map((m) => m.playerId).sort()).toEqual([MEMBER, OWNER].sort());
    });

    it('404s a non-member — the SAME answer as an unknown league', async () => {
      await seedLeague();

      const outsider = await fetch(url('/leagues/lg-roster/members'), {
        headers: playerToken(OUTSIDER),
      });
      const missing = await fetch(url('/leagues/lg-does-not-exist/members'), {
        headers: playerToken(OUTSIDER),
      });

      // Identical status AND body: a 403 here would confirm that a private
      // league exists, which is exactly what invite-only is meant to prevent.
      expect(outsider.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(await outsider.json()).toEqual(await missing.json());
    });

    it('refuses an unauthenticated caller', async () => {
      await seedLeague();
      const res = await fetch(url('/leagues/lg-roster/members'));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('never returns a balance for anyone', async () => {
      await seedLeague();
      const res = await fetch(url('/leagues/lg-roster/members'), {
        headers: playerToken(OWNER),
      });
      const body = (await res.json()) as { members: Record<string, unknown>[] };
      for (const m of body.members) {
        expect(Object.keys(m).sort()).toEqual(['joinedAt', 'playerId', 'role']);
      }
    });
  });
});
