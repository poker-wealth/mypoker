import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Decimal128 } from 'bson';
import { createApp } from '../../src/http/app';
import { AccountModel } from '../../src/wallet/account.model';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { SecurityLogModel } from '../../src/security/security-log.model';
import { SettlementModel } from '../../src/settlement/settlement.model';
import { WithdrawalModel } from '../../src/withdrawal/withdrawal.model';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * GET /internal/table-settlements/:roundId (BUG-20) — lets a room that lost the settlement HTTP
 * response ask FC whether the round it thinks failed actually committed, before it abandons a hand
 * FC already paid.
 */

const INTERNAL_SECRET = 'test-internal-secret';

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

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url(path), { method: 'GET', headers });
}

const internal = { 'x-internal-secret': INTERNAL_SECRET };

describe('GET /internal/table-settlements/:roundId', () => {
  beforeAll(async () => {
    process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    process.env.JWT_SECRET = 'test-jwt-secret';
    await startTestDb();
    await ensureIndexes(AccountModel, LedgerModel, SecurityLogModel, SettlementModel, WithdrawalModel);
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

  it('an unknown roundId is settled: false', async () => {
    const res = await get('/internal/table-settlements/never-happened', internal);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ settled: false });
  });

  it('missing the shared secret is 401', async () => {
    const res = await get('/internal/table-settlements/anything');
    expect(res.status).toBe(401);
  });

  it('a round settled via POST /internal/table-settlements comes back settled:true with parties keyed by playerId and amounts equal', async () => {
    const mk = async (owner: string, lockedAmt: string): Promise<string> =>
      (
        await AccountModel.create({
          accountType: 'PLAYER',
          ownerId: owner,
          lockedBalance: Decimal128.fromString(lockedAmt),
        })
      )._id;
    await mk('sp0', '1000');
    await mk('sp1', '1000');
    await AccountModel.create({ accountType: 'TREASURY', ownerId: 'PLATFORM' });
    const pool = async (t: string): Promise<string> =>
      (await AccountModel.create({ accountType: t, ownerId: 'st' }))._id;

    const settle = await post(
      '/internal/table-settlements',
      {
        roundId: 'rt-status-1',
        tableType: 'PLATFORM',
        losers: [{ playerAccountId: 'sp1', amount: '1000' }],
        winners: [{ playerAccountId: 'sp0', amount: '950' }],
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
    expect(settle.status).toBe(200);
    expect(await settle.json()).toMatchObject({ roundId: 'rt-status-1', applied: true });

    const res = await get('/internal/table-settlements/rt-status-1', internal);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      settled: boolean;
      receipt: {
        roundId: string;
        rake: string;
        jackpotTotal: string;
        losers: { playerAccountId: string; amount: string }[];
        winners: { playerAccountId: string; amount: string }[];
      };
    };
    expect(body.settled).toBe(true);
    expect(body.receipt.roundId).toBe('rt-status-1');
    expect(body.receipt.rake).toBe('50.000000');
    expect(body.receipt.jackpotTotal).toBe('0.000000');
    expect(body.receipt.losers).toEqual([{ playerAccountId: 'sp1', amount: '1000.000000' }]);
    expect(body.receipt.winners).toEqual([{ playerAccountId: 'sp0', amount: '950.000000' }]);
  });

  it('a settled single-leg /internal/settlements round has no table receipt: settled:true, no receipt', async () => {
    // settleRound (single-leg) stores a SettlementReceipt, not a table receipt — receipt.type !== 'table'.
    await SettlementModel.create({
      roundId: 'rt-status-single-leg',
      receipt: {
        roundId: 'rt-status-single-leg',
        sequence: ['jackpot_inject', 'rake', 'payout'],
        amounts: { jackpot: '0.000000', rake: '0.000000', payout: '0.000000' },
        accounts: {
          jackpotMini: 'a', jackpotMinor: 'a', jackpotMajor: 'a', jackpotGrand: 'a', rakeDest: 'a', winner: 'a',
        },
        hash: 'deadbeef',
      },
    });
    const res = await get('/internal/table-settlements/rt-status-single-leg', internal);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ settled: true });
  });
});
