import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Decimal128 } from 'bson';
import { createApp } from '../../src/http/app';
import { AccountModel } from '../../src/wallet/account.model';
import { WithdrawalModel } from '../../src/withdrawal/withdrawal.model';
import {
  requestWithdrawal,
  approveWithdrawal,
  broadcastWithdrawal,
} from '../../src/withdrawal/withdrawal-state-machine';
import { WithdrawalState } from '../../src/domain/withdrawal-types';
import { Money } from '../../src/domain/money';
import { AccountType } from '../../src/domain/account-types';
import { startTestDb, stopTestDb, clearCollections } from '../db-helper';

/**
 * BUG-09 guard: `/internal/withdrawals/:id/reject` must not refund a withdrawal whose broadcast is
 * unresolved (`pendingTxId` set) unless the caller explicitly says they checked the chain — otherwise
 * a reject after an ambiguous broadcast can refund AND leave the on-chain transfer live.
 */

const INTERNAL_SECRET = 'test-internal-secret';
let server: Server;
let base: string;

function url(path: string): string {
  return `${base}${path}`;
}

const internal = { 'x-internal-secret': INTERNAL_SECRET, 'content-type': 'application/json' };

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(url(path), { method: 'POST', headers: internal, body: JSON.stringify(body) });
}

async function makePlayer(available: string): Promise<string> {
  const a = await AccountModel.create({
    accountType: AccountType.PLAYER,
    ownerId: 'p1',
    availableBalance: Decimal128.fromString(available),
  });
  return a._id;
}

async function approvedWithdrawal(): Promise<string> {
  const player = await makePlayer('1000');
  const id = await requestWithdrawal({
    playerAccountId: player,
    amount: Money.fromDecimalString('300'),
    address: 'TXaddrTest',
  });
  await approveWithdrawal(id, 'ops-1');
  return id;
}

async function approvedWithdrawalWithPlayer(): Promise<{ id: string; player: string }> {
  const player = await makePlayer('1000');
  const id = await requestWithdrawal({
    playerAccountId: player,
    amount: Money.fromDecimalString('300'),
    address: 'TXaddrTest',
  });
  await approveWithdrawal(id, 'ops-1');
  return { id, player };
}

async function balances(id: string): Promise<{ available: number; clearing: number }> {
  const a = await AccountModel.findById(id);
  return {
    available: parseFloat(a!.availableBalance.toString()),
    clearing: parseFloat(a!.clearingBalance.toString()),
  };
}

describe('POST /internal/withdrawals/:id/reject', () => {
  beforeAll(async () => {
    process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    process.env.JWT_SECRET = 'test-jwt-secret';
    await startTestDb();
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

  it('rejects normally when there is no unresolved broadcast', async () => {
    const id = await approvedWithdrawal();
    const res = await post(`/internal/withdrawals/${id}/reject`, {
      rejectedBy: 'ops-1',
      reason: 'risk flagged',
    });
    expect(res.status).toBe(200);
    expect((await WithdrawalModel.findById(id))!.state).toBe(WithdrawalState.ROLLED_BACK);
  });

  it('refuses to reject (and refund) while pendingTxId is set, without chainChecked', async () => {
    const id = await approvedWithdrawal();
    await WithdrawalModel.updateOne({ _id: id }, { $set: { pendingTxId: 'a'.repeat(64) } });

    const res = await post(`/internal/withdrawals/${id}/reject`, {
      rejectedBy: 'ops-1',
      reason: 'risk flagged',
    });
    expect(res.status).toBe(409);

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.APPROVED); // untouched — no refund
    expect(w!.pendingTxId).toBe('a'.repeat(64));
  });

  it('allows the reject through once the caller explicitly confirms chainChecked', async () => {
    const id = await approvedWithdrawal();
    await WithdrawalModel.updateOne({ _id: id }, { $set: { pendingTxId: 'a'.repeat(64) } });

    const res = await post(`/internal/withdrawals/${id}/reject`, {
      rejectedBy: 'ops-1',
      reason: 'confirmed never landed on-chain',
      chainChecked: true,
    });
    expect(res.status).toBe(200);
    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.ROLLED_BACK);
    // D9: recorded even on the legacy (no pendingTxExpiration) path.
    expect(w!.rejectedBy).toBe('ops-1');
    expect(w!.chainCheckedBy).toBe('ops-1');
  });

  // D7: BROADCASTING means a real transfer is live on-chain right now — a reject reaching one (the
  // watcher's own reconcile pass can advance a row to BROADCASTING while an admin has the sheet open)
  // must never refund it, chainChecked or not. Only the watcher, having actually checked the chain,
  // ever rolls a BROADCASTING withdrawal back.
  it('BUG-09 D7: refuses to reject a BROADCASTING withdrawal even with chainChecked:true', async () => {
    const { id, player } = await approvedWithdrawalWithPlayer();
    await WithdrawalModel.updateOne({ _id: id }, { $set: { pendingTxId: 'a'.repeat(64) } });
    await broadcastWithdrawal(id, 'a'.repeat(64)); // resolves the pendingTxId — now BROADCASTING

    const res = await post(`/internal/withdrawals/${id}/reject`, {
      rejectedBy: 'ops-1',
      reason: 'confirmed never landed on-chain',
      chainChecked: true,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already broadcast/);

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.BROADCASTING); // untouched — no refund
    expect(await balances(player)).toEqual({ available: 700, clearing: 300 }); // no double-pay
  });

  // D8: a chainChecked reject of an unresolved broadcast is only trustworthy once the signed tx could
  // actually be dead — before its own expiration (+ the watcher's grace period), TronGrid could still
  // mine it at any moment.
  it('BUG-09 D8: refuses a chainChecked reject before the pending tx could plausibly be dead', async () => {
    const id = await approvedWithdrawal();
    await WithdrawalModel.updateOne(
      { _id: id },
      { $set: { pendingTxId: 'a'.repeat(64), pendingTxExpiration: new Date(Date.now() + 30_000) } },
    );

    const res = await post(`/internal/withdrawals/${id}/reject`, {
      rejectedBy: 'ops-1',
      reason: 'confirmed never landed on-chain',
      chainChecked: true,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/cannot be declared dead/);

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.APPROVED); // untouched — no refund
    expect(w!.pendingTxId).toBe('a'.repeat(64));
  });

  it('BUG-09 D8: allows a chainChecked reject once the pending tx is well past expiration + grace', async () => {
    const id = await approvedWithdrawal();
    await WithdrawalModel.updateOne(
      { _id: id },
      { $set: { pendingTxId: 'a'.repeat(64), pendingTxExpiration: new Date(Date.now() - 10 * 60_000) } },
    );

    const res = await post(`/internal/withdrawals/${id}/reject`, {
      rejectedBy: 'ops-1',
      reason: 'confirmed never landed on-chain, well past expiration',
      chainChecked: true,
    });
    expect(res.status).toBe(200);
    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.ROLLED_BACK);
  });
});
