import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Decimal128 } from 'bson';
import { createApp } from '../../src/http/app';
import { AccountModel } from '../../src/wallet/account.model';
import { WithdrawalModel } from '../../src/withdrawal/withdrawal.model';
import { requestWithdrawal, approveWithdrawal } from '../../src/withdrawal/withdrawal-state-machine';
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
    expect((await WithdrawalModel.findById(id))!.state).toBe(WithdrawalState.ROLLED_BACK);
  });
});
