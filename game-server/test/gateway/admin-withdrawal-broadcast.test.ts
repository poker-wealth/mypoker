import request from 'supertest';
import { createGatewayApp } from '../../src/gateway/app';
import { loadConfig } from '../../src/gateway/config';
import { signToken } from '../../src/gateway/tokens';

/**
 * BUG-09 follow-up (D4d), gateway layer:
 *
 *  - `/withdrawals/:id/reject` forwards `chainChecked` straight through to financial-core, never
 *    inventing or defaulting it away from what the admin actually confirmed.
 *  - the new `/withdrawals/:id/broadcast` passthrough (an admin marking an unresolved send as
 *    confirmed-landed) is behind the SAME admin auth as every other withdrawal action — a queue screen
 *    that can resolve a stuck send is exactly the kind of route that must not be left open by mistake.
 *
 * BUG-09 second follow-up (D9/D10), gateway layer:
 *
 *  - `/withdrawals/:id/send` and `/withdrawals/:id/broadcast` both attach the acting admin
 *    (`sentBy`/`resolvedBy`) from the verified token, never the body — same rule as `approverId` and
 *    `rejectedBy`.
 *  - `/withdrawals/:id/broadcast` always sets `requirePending: true` — this action exists only to
 *    resolve the ONE send actually pending on a withdrawal, never to record an arbitrary txHash.
 */

const JWT_SECRET = 'test-secret-withdrawal-broadcast';
const WITHDRAWAL_ID = 'w-1';

const opsToken = signToken({ playerId: 'admin-1', role: 'ops' }, JWT_SECRET, 300);
const playerToken = signToken({ playerId: 'nobody', role: 'player' }, JWT_SECRET, 300);

const app = () =>
  createGatewayApp(
    loadConfig({
      JWT_SECRET,
      NODE_ENV: 'test',
      FINANCIAL_CORE_URL: 'http://financial-core.internal',
    } as NodeJS.ProcessEnv),
  );

describe('POST /admin/withdrawals/:id/reject — forwards chainChecked', () => {
  let calls: { url: string; body: unknown }[];

  beforeEach(() => {
    calls = [];
    global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return {
        ok: true,
        status: 200,
        json: async () => ({ state: 'ROLLED_BACK' }),
      };
    }) as unknown as typeof fetch;
  });

  it('forwards chainChecked: true when the admin confirmed it', async () => {
    const res = await request(app())
      .post(`/admin/withdrawals/${WITHDRAWAL_ID}/reject`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ reason: 'confirmed never landed on-chain', chainChecked: true });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain(`/internal/withdrawals/${WITHDRAWAL_ID}/reject`);
    expect(calls[0]!.body).toMatchObject({
      rejectedBy: 'admin-1', // from the verified token, never the body
      reason: 'confirmed never landed on-chain',
      chainChecked: true,
    });
  });

  it('forwards chainChecked: false (not omitted) when the admin did not confirm', async () => {
    const res = await request(app())
      .post(`/admin/withdrawals/${WITHDRAWAL_ID}/reject`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ reason: 'risk flagged' });

    expect(res.status).toBe(200);
    expect(calls[0]!.body).toMatchObject({ chainChecked: false });
  });

  it('never lets the body itself claim chainChecked as anything other than a strict boolean true', async () => {
    // A client sending the string 'true', or any other truthy-looking value, must not be read as
    // confirmation — only a literal boolean true means "an admin actually checked the chain".
    const res = await request(app())
      .post(`/admin/withdrawals/${WITHDRAWAL_ID}/reject`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ reason: 'risk flagged', chainChecked: 'true' });

    expect(res.status).toBe(200);
    expect(calls[0]!.body).toMatchObject({ chainChecked: false });
  });
});

describe('POST /admin/withdrawals/:id/broadcast — resolve an unresolved send', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ state: 'BROADCASTING' }),
    })) as unknown as typeof fetch;
  });

  it('404s — not 403 — for an ordinary player, like every other admin route', async () => {
    const res = await request(app())
      .post(`/admin/withdrawals/${WITHDRAWAL_ID}/broadcast`)
      .set('authorization', `Bearer ${playerToken}`)
      .send({ txHash: 'a'.repeat(64) });

    expect(res.status).toBe(404);
  });

  it('401s with no token at all', async () => {
    const res = await request(app())
      .post(`/admin/withdrawals/${WITHDRAWAL_ID}/broadcast`)
      .send({ txHash: 'a'.repeat(64) });

    expect(res.status).toBe(401);
  });

  it('lets ops through and forwards the txHash to the same FC route the watcher/admin both use', async () => {
    const res = await request(app())
      .post(`/admin/withdrawals/${WITHDRAWAL_ID}/broadcast`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ txHash: 'a'.repeat(64) });

    expect(res.status).toBe(200);
    const [[calledUrl, calledInit]] = (global.fetch as jest.Mock).mock.calls as [
      [string, RequestInit],
    ];
    expect(calledUrl).toContain(`/internal/withdrawals/${WITHDRAWAL_ID}/broadcast`);
    // D9: resolvedBy comes from the verified token, never the body. D10: requirePending is always set
    // on this action — it resolves the one send actually pending, never an arbitrary txHash.
    expect(JSON.parse(String(calledInit.body))).toEqual({
      txHash: 'a'.repeat(64),
      resolvedBy: 'admin-1',
      requirePending: true,
    });
  });
});

describe('POST /admin/withdrawals/:id/send — sign + broadcast, attributed to the acting admin', () => {
  let calls: { url: string; body: unknown }[];

  beforeEach(() => {
    calls = [];
    global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return {
        ok: true,
        status: 200,
        json: async () => ({ state: 'APPROVED', txHash: 'a'.repeat(64) }),
      };
    }) as unknown as typeof fetch;
  });

  it('forwards sentBy from the verified token, never the body', async () => {
    const res = await request(app())
      .post(`/admin/withdrawals/${WITHDRAWAL_ID}/send`)
      .set('authorization', `Bearer ${opsToken}`)
      .send({ sentBy: 'someone-else' }); // ignored — must come from the token

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain(`/internal/withdrawals/${WITHDRAWAL_ID}/sign-broadcast`);
    expect(calls[0]!.body).toEqual({ sentBy: 'admin-1' });
  });
});
