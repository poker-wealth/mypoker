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
 * BUG-09 follow-up guards on the two manual withdrawal endpoints:
 *
 *  D3 — POST /internal/withdrawals/:id/broadcast must not accept an arbitrary txHash while a real
 *  broadcast is unresolved (`pendingTxId` set): an admin (or a buggy client) supplying the wrong hash
 *  would otherwise silently discard the actual pending send and record a fabricated one instead.
 *
 *  D4(c) — a pendingTxId refusal is a typed WithdrawalBroadcastPendingError, mapped to 409, so a
 *  client sees a specific, machine-readable reason rather than a generic error.
 */

const INTERNAL_SECRET = 'test-internal-secret-broadcast';
const HOT_WALLET_KEY = 'da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0';
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

describe('POST /internal/withdrawals/:id/broadcast and /sign-broadcast (BUG-09 follow-up)', () => {
  beforeAll(async () => {
    process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    process.env.JWT_SECRET = 'test-jwt-secret-broadcast';
    // Only the /sign-broadcast tests need this — they reach signerConfigFromEnv() before the pendingTxId
    // check runs, and with no key configured that throws first, obscuring what's under test.
    process.env.TRON_HOT_WALLET_KEY = HOT_WALLET_KEY;
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
    delete process.env.TRON_HOT_WALLET_KEY;
    await stopTestDb();
  });

  afterEach(clearCollections);

  describe('/broadcast', () => {
    it('D3: refuses a txHash that does not match the unresolved pendingTxId', async () => {
      const id = await approvedWithdrawal();
      await WithdrawalModel.updateOne({ _id: id }, { $set: { pendingTxId: 'a'.repeat(64) } });

      const res = await post(`/internal/withdrawals/${id}/broadcast`, { txHash: 'b'.repeat(64) });
      expect(res.status).toBe(409);

      const w = await WithdrawalModel.findById(id);
      expect(w!.state).toBe(WithdrawalState.APPROVED); // untouched
      expect(w!.pendingTxId).toBe('a'.repeat(64)); // the real pending send was not discarded
    });

    it('D3: accepts a txHash that matches the unresolved pendingTxId, clearing it', async () => {
      const id = await approvedWithdrawal();
      await WithdrawalModel.updateOne({ _id: id }, { $set: { pendingTxId: 'a'.repeat(64) } });

      const res = await post(`/internal/withdrawals/${id}/broadcast`, { txHash: 'a'.repeat(64) });
      expect(res.status).toBe(200);

      const w = await WithdrawalModel.findById(id);
      expect(w!.state).toBe(WithdrawalState.BROADCASTING);
      expect(w!.txHash).toBe('a'.repeat(64));
      expect(w!.pendingTxId).toBeUndefined();
    });

    it('still works normally with no pendingTxId set at all', async () => {
      const id = await approvedWithdrawal();
      const res = await post(`/internal/withdrawals/${id}/broadcast`, { txHash: 'c'.repeat(64) });
      expect(res.status).toBe(200);
      expect((await WithdrawalModel.findById(id))!.state).toBe(WithdrawalState.BROADCASTING);
    });
  });

  describe('/sign-broadcast', () => {
    it('D4(c): 409s with a specific reason when a broadcast is already unresolved', async () => {
      const id = await approvedWithdrawal();
      await WithdrawalModel.updateOne({ _id: id }, { $set: { pendingTxId: 'd'.repeat(64) } });

      const res = await post(`/internal/withdrawals/${id}/sign-broadcast`, {});
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/already broadcast/);

      const w = await WithdrawalModel.findById(id);
      expect(w!.state).toBe(WithdrawalState.APPROVED); // untouched
      expect(w!.pendingTxId).toBe('d'.repeat(64));
    });
  });
});
