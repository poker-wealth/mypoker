/**
 * End-to-end smoke run — drives the whole Financial Core money lifecycle against a LIVE HTTP server
 * (booted on an in-memory replica set, zero install) and narrates each step with ✅ / ❌.
 *
 *   npm run smoke
 *
 * Watch: deposit → balance → buy-in → release → settle (jackpot+rake) → withdraw lifecycle →
 * illegal-flow rejection (CB6) → ledger stays balanced (Σdebit = Σcredit).
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connectDb, disconnectDb } from '../src/db/connection';
import { createApp } from '../src/http/app';
import { signToken } from '../src/http/jwt';
import { getOrCreatePlayerAccount } from '../src/wallet/system-accounts';
import { AccountModel } from '../src/wallet/account.model';
import { LedgerModel } from '../src/wallet/ledger.model';
import { transfer } from '../src/wallet/transfer';
import { IllegalFundFlowError } from '../src/wallet/errors';
import { Money } from '../src/domain/money';
import { AccountType, LedgerType, LedgerDirection } from '../src/domain/account-types';
import { OFFICIAL_USDT_TRC20_CONTRACT } from '../src/deposit/trc20';

const INTERNAL = 'dev-internal-secret';
const JWT = 'dev-jwt-secret';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass++;
    console.log(`   \x1b[32m✅ ${label}\x1b[0m`);
  } else {
    fail++;
    console.log(`   \x1b[31m❌ ${label}\x1b[0m ${detail}`);
  }
}

async function main(): Promise<void> {
  process.env.INTERNAL_API_SECRET = INTERNAL;
  process.env.JWT_SECRET = JWT;

  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connectDb({ uri: rs.getUri('fc_smoke') });
  await AccountModel.init();
  await LedgerModel.init();
  await AccountModel.create({ accountType: AccountType.TREASURY, ownerId: 'PLATFORM' });

  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/v1`;
  const token = signToken({ playerId: 'p-demo', role: 'player' }, JWT, 3600);

  type Json = Record<string, unknown>;
  async function api(
    method: string,
    path: string,
    opts: { body?: unknown; player?: boolean; internal?: boolean } = {},
  ): Promise<{ status: number; json: Json }> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.player) headers.authorization = `Bearer ${token}`;
    if (opts.internal) headers['x-internal-secret'] = INTERNAL;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as Json;
    return { status: res.status, json };
  }
  const bal = async (): Promise<{ available: number; locked: number; clearing: number }> => {
    const { json } = await api('GET', '/me/balance', { player: true });
    return {
      available: parseFloat(json.available as string),
      locked: parseFloat(json.locked as string),
      clearing: parseFloat(json.clearing as string),
    };
  };

  console.log(`\n\x1b[1mFairPlay Financial Core — live smoke run\x1b[0m  (${base})\n`);

  console.log('1) Health');
  const health = await api('GET', '/health');
  check('GET /health → 200 ok', health.status === 200 && health.json.status === 'ok');

  console.log('2) Deposit 500 USDT (official contract, 20 confirmations)');
  const dep = await api('POST', '/internal/deposits', {
    internal: true,
    body: {
      playerId: 'p-demo',
      amount: '500',
      txHash: 'tx-smoke-1',
      contractAddress: OFFICIAL_USDT_TRC20_CONTRACT,
      confirmations: 20,
    },
  });
  check('deposit credited', dep.json.credited === true);
  check('balance available = 500', (await bal()).available === 500);

  console.log('3) Reject an unconfirmed (mempool) deposit');
  const memp = await api('POST', '/internal/deposits', {
    internal: true,
    body: {
      playerId: 'p-demo',
      amount: '999',
      txHash: 'tx-mempool',
      contractAddress: OFFICIAL_USDT_TRC20_CONTRACT,
      confirmations: 3,
    },
  });
  check('mempool deposit NOT credited', memp.json.credited === false && memp.json.reason === 'unconfirmed');
  check('balance unchanged = 500', (await bal()).available === 500);

  console.log('4) Buy in 300 at a table (available → locked)');
  const player = await getOrCreatePlayerAccount('p-demo');
  await api('POST', '/internal/buy-ins', { internal: true, body: { playerAccountId: player._id, amount: '300' } });
  const b4 = await bal();
  check('available 200 / locked 300', b4.available === 200 && b4.locked === 300, JSON.stringify(b4));

  console.log('5) Locked funds are NOT withdrawable');
  const overW = await api('POST', '/me/withdrawals', { player: true, body: { amount: '250', address: 'TXaddr' } });
  check('withdraw 250 (> available 200) → 409', overW.status === 409);

  console.log('6) Leave table with 100 (locked → available)');
  await api('POST', '/internal/releases', { internal: true, body: { playerAccountId: player._id, amount: '100' } });
  const b6 = await bal();
  check('available 300 / locked 200', b6.available === 300 && b6.locked === 200, JSON.stringify(b6));

  console.log('7) Settle a hand — jackpot (0.5%) + rake, winner = p-demo');
  const pool = async (t: AccountType): Promise<string> =>
    (await AccountModel.create({ accountType: t, ownerId: 'demo-table' }))._id;
  const settle = await api('POST', '/internal/settlements', {
    internal: true,
    body: {
      roundId: 'r-smoke-1',
      tableType: 'PLATFORM',
      winnerAccountId: player._id,
      winnerProfit: '1000',
      rake: '50',
      jackpotAccounts: {
        mini: await pool(AccountType.JACKPOT_MINI),
        minor: await pool(AccountType.JACKPOT_MINOR),
        major: await pool(AccountType.JACKPOT_MAJOR),
        grand: await pool(AccountType.JACKPOT_GRAND),
      },
    },
  });
  check('settlement receipt returned', Array.isArray(settle.json.sequence));
  const b7 = await bal();
  check('winner paid 55 (jackpot 5 + rake 50): available 245', b7.available === 245, JSON.stringify(b7));

  console.log('8) Withdraw 100 — full lifecycle REQUESTED → APPROVED → BROADCASTING → CONFIRMED');
  const wreq = await api('POST', '/me/withdrawals', { player: true, body: { amount: '100', address: 'TXaddr' } });
  const wid = wreq.json.withdrawalId as string;
  check('withdrawal REQUESTED', wreq.status === 201 && wreq.json.state === 'REQUESTED');
  const apv = await api('POST', `/internal/withdrawals/${wid}/approve`, { internal: true, body: { approverId: 'ops-smoke' } });
  check('APPROVED (funds held in clearing)', apv.json.state === 'APPROVED');
  const ba = await bal();
  check('available 145 / clearing 100', ba.available === 145 && ba.clearing === 100, JSON.stringify(ba));
  await api('POST', `/internal/withdrawals/${wid}/broadcast`, { internal: true, body: { txHash: 'tx-out-1' } });
  const cf = await api('POST', `/internal/withdrawals/${wid}/confirm`, { internal: true });
  check('CONFIRMED (funds left platform)', cf.json.state === 'CONFIRMED');
  check('clearing 0', (await bal()).clearing === 0);

  console.log('9) Circuit breaker CB6 — illegal fund flow is rejected');
  const reins = await AccountModel.create({ accountType: AccountType.REINSURANCE, ownerId: 'PLATFORM' });
  let cb6 = false;
  try {
    await transfer({
      fromAccountId: player._id,
      toAccountId: reins._id,
      amount: Money.fromDecimalString('1'),
      type: LedgerType.BET,
      idempotencyKey: 'smoke-illegal',
    });
  } catch (e) {
    cb6 = e instanceof IllegalFundFlowError;
  }
  check('PLAYER → REINSURANCE blocked by CB6', cb6);

  console.log('10) Ledger integrity — double-entry stays balanced');
  const agg = await LedgerModel.aggregate<{ _id: LedgerDirection; total: { toString(): string } }>([
    { $group: { _id: '$direction', total: { $sum: '$amount' } } },
  ]);
  const totals = Object.fromEntries(agg.map((x) => [x._id, x.total.toString()]));
  check(
    `Σ(DEBIT) = Σ(CREDIT)  (${totals[LedgerDirection.DEBIT]} = ${totals[LedgerDirection.CREDIT]})`,
    totals[LedgerDirection.DEBIT] === totals[LedgerDirection.CREDIT],
  );

  console.log(`\n\x1b[1mRESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectDb();
  await rs.stop();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
