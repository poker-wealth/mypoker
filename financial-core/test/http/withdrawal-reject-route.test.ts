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
  confirmWithdrawal,
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

  // D13: `allowPendingTx` alone used to drop the pendingTxId guard from rollbackWithdrawal's filter
  // entirely — it matched ANY pendingTxId, not just the one an admin actually chain-checked. These pin
  // the fix: the route now names the exact tx it read (`pendingAtRead`) and the filter refuses to match
  // if that tx changes before the write lands, surfacing a 409 instead of refunding a live send.
  //
  // The race is injected with a spy on WithdrawalModel.findById: the route's own read is call #1, and
  // rollbackWithdrawal's internal read-then-write (inside loadOrThrow) is call #2 — the mutation lands
  // immediately after call #2 resolves, in the exact gap between that read and the atomic write.
  it('BUG-09 D13: a pendingTxId CAS between the route read and the rollback write refuses, no refund', async () => {
    const { id, player } = await approvedWithdrawalWithPlayer(); // no pendingTxId at read time

    const original = WithdrawalModel.findById.bind(WithdrawalModel);
    let calls = 0;
    const spy = jest.spyOn(WithdrawalModel, 'findById').mockImplementation(
      ((...args: Parameters<typeof original>) =>
        (async () => {
          calls++;
          const doc = await original(...args);
          if (calls === 2) {
            // A re-send CAS (withdrawal-broadcast.ts) lands a fresh, LIVE pendingTxId in the gap —
            // there was nothing pending when the route read this withdrawal moments ago.
            await WithdrawalModel.updateOne({ _id: id }, { $set: { pendingTxId: 'f'.repeat(64) } });
          }
          return doc;
        })()) as unknown as typeof original,
    );
    try {
      const res = await post(`/internal/withdrawals/${id}/reject`, {
        rejectedBy: 'ops-1',
        reason: 'refused',
        chainChecked: true,
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/changed while being refused/);
    } finally {
      spy.mockRestore();
    }

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.APPROVED); // untouched — no refund
    expect(w!.pendingTxId).toBe('f'.repeat(64)); // the live send is still there, unrefunded
    expect(await balances(player)).toEqual({ available: 700, clearing: 300 }); // no double-pay
  });

  it('BUG-09 D13: the chain-checked tx being swapped for a different one before the write refuses, no refund', async () => {
    const id = await approvedWithdrawal();
    const player = (await WithdrawalModel.findById(id))!.playerAccountId;
    const expiredTx = 'a'.repeat(64);
    await WithdrawalModel.updateOne(
      { _id: id },
      {
        $set: {
          pendingTxId: expiredTx,
          pendingTxExpiration: new Date(Date.now() - 10 * 60_000), // well past expiration + grace
        },
      },
    );

    const original = WithdrawalModel.findById.bind(WithdrawalModel);
    let calls = 0;
    const spy = jest.spyOn(WithdrawalModel, 'findById').mockImplementation(
      ((...args: Parameters<typeof original>) =>
        (async () => {
          calls++;
          const doc = await original(...args);
          if (calls === 2) {
            // The tx this admin chain-checked (expiredTx) is gone — a watcher release followed by a
            // re-send CAS replaced it with a fresh, LIVE tx (freshTx) in the gap before this write.
            await WithdrawalModel.updateOne(
              { _id: id },
              { $unset: { pendingTxId: '', pendingTxExpiration: '' } },
            );
            await WithdrawalModel.updateOne({ _id: id }, { $set: { pendingTxId: 'c'.repeat(64) } });
          }
          return doc;
        })()) as unknown as typeof original,
    );
    try {
      const res = await post(`/internal/withdrawals/${id}/reject`, {
        rejectedBy: 'ops-1',
        reason: 'confirmed never landed on-chain',
        chainChecked: true,
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/changed while being refused/);
    } finally {
      spy.mockRestore();
    }

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.APPROVED); // untouched — no refund
    expect(w!.pendingTxId).toBe('c'.repeat(64)); // the fresh live send is still there, unrefunded
    expect(await balances(player)).toEqual({ available: 700, clearing: 300 }); // no double-pay
  });

  // BUG-09 follow-up: a withdrawal already in a terminal state has nothing left to refuse. Before
  // this, refusing one fell through to rollbackWithdrawal's generic InvalidWithdrawalTransitionError,
  // remapped to "changed while being refused — reload and check again" — which reads like a race an
  // admin should retry, when in fact retrying can never succeed.
  it('BUG-09 follow-up: refuses a second reject of an already-ROLLED_BACK withdrawal with a clear message', async () => {
    const { id, player } = await approvedWithdrawalWithPlayer();
    const first = await post(`/internal/withdrawals/${id}/reject`, {
      rejectedBy: 'ops-1',
      reason: 'risk flagged',
    });
    expect(first.status).toBe(200);
    expect((await WithdrawalModel.findById(id))!.state).toBe(WithdrawalState.ROLLED_BACK);

    const second = await post(`/internal/withdrawals/${id}/reject`, {
      rejectedBy: 'ops-2',
      reason: 'trying again',
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toMatch(/already ROLLED_BACK/);

    // Balances are exactly what the first (successful) reject already produced — the
    // refused second attempt moved nothing.
    expect(await balances(player)).toEqual({ available: 1000, clearing: 0 });
  });

  it('BUG-09 follow-up: refuses to reject an already-CONFIRMED withdrawal with a clear message', async () => {
    const { id, player } = await approvedWithdrawalWithPlayer();
    await broadcastWithdrawal(id, 'a'.repeat(64));
    await confirmWithdrawal(id);
    expect((await WithdrawalModel.findById(id))!.state).toBe(WithdrawalState.CONFIRMED);

    const res = await post(`/internal/withdrawals/${id}/reject`, {
      rejectedBy: 'ops-1',
      reason: 'trying to refund a paid withdrawal',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already CONFIRMED/);

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.CONFIRMED); // untouched
    // Confirmed money left the platform via clearing → external, not back to the player.
    expect(await balances(player)).toEqual({ available: 700, clearing: 0 });
  });
});
