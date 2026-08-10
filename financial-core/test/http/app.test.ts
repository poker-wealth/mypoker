import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Decimal128 } from 'bson';
import { createApp } from '../../src/http/app';
import { signToken } from '../../src/http/jwt';
import { AccountModel } from '../../src/wallet/account.model';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { SecurityLogModel } from '../../src/security/security-log.model';

/**
 * A checksum-valid TRON address (the public USDT-TRC20 contract).
 *
 * Real rather than a placeholder because /me/withdrawals validates the address
 * before creating any state — a fake string makes every withdrawal test a test
 * of the validator instead of the flow it means to exercise.
 */
const VALID_TRON_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
import { SettlementModel } from '../../src/settlement/settlement.model';
import { WithdrawalModel } from '../../src/withdrawal/withdrawal.model';
import { OFFICIAL_USDT_TRC20_CONTRACT } from '../../src/deposit/trc20';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

const INTERNAL_SECRET = 'test-internal-secret';
const JWT_SECRET = 'test-jwt-secret';

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

    // Player requests a withdrawal.
    // A checksum-valid TRON address. 'TXaddr' was a placeholder, and the
    // withdrawal route now rejects malformed addresses before creating any
    // state — so the test data has to be a real address or it exercises the
    // validator instead of the flow.
    const wRes = await post(
      '/me/withdrawals',
      { amount: '200', address: VALID_TRON_ADDRESS },
      playerToken('p-api'),
    );
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

    // Overdraft withdrawal → 409.
    const res = await post(
      '/me/withdrawals',
      { amount: '999', address: VALID_TRON_ADDRESS },
      playerToken('broke'),
    );
    expect(res.status).toBe(409);
  });

  it('runs the internal settlement endpoint', async () => {
    // Fund a winner account directly, create treasury + jackpot pools, then settle.
    const winner = await AccountModel.create({
      accountType: 'PLAYER',
      ownerId: 'w',
      availableBalance: Decimal128.fromString('1000'),
    });
    await AccountModel.create({ accountType: 'TREASURY', ownerId: 'PLATFORM' });
    const pools = {
      mini: (await AccountModel.create({ accountType: 'JACKPOT_MINI', ownerId: 't' }))._id,
      minor: (await AccountModel.create({ accountType: 'JACKPOT_MINOR', ownerId: 't' }))._id,
      major: (await AccountModel.create({ accountType: 'JACKPOT_MAJOR', ownerId: 't' }))._id,
      grand: (await AccountModel.create({ accountType: 'JACKPOT_GRAND', ownerId: 't' }))._id,
    };
    const res = await post(
      '/internal/settlements',
      {
        roundId: 'r-api-1',
        tableType: 'PLATFORM',
        winnerAccountId: winner._id,
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

  it('settles a full table hand via /internal/table-settlements', async () => {
    const mk = async (owner: string, lockedAmt: string): Promise<string> =>
      (
        await AccountModel.create({
          accountType: 'PLAYER',
          ownerId: owner,
          lockedBalance: Decimal128.fromString(lockedAmt),
        })
      )._id;
    const p0 = await mk('tp0', '1000');
    const p1 = await mk('tp1', '1000');
    await AccountModel.create({ accountType: 'TREASURY', ownerId: 'PLATFORM' });
    const pool = async (t: string): Promise<string> =>
      (await AccountModel.create({ accountType: t, ownerId: 'tt' }))._id;

    const res = await post(
      '/internal/table-settlements',
      {
        roundId: 'rt-1',
        tableType: 'PLATFORM',
        losers: [{ playerAccountId: p1, amount: '1000' }],
        winners: [{ playerAccountId: p0, amount: '950' }],
        rake: '50',
        jackpot: { mini: '0', minor: '0', major: '0', grand: '0' },
        jackpotAccounts: {
          mini: await pool('JACKPOT_MINI'),
          minor: await pool('JACKPOT_MINOR'),
          major: await pool('JACKPOT_MAJOR'),
          grand: await pool('JACKPOT_GRAND'),
        },
      },
      internal,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ roundId: 'rt-1', applied: true });
  });
});
