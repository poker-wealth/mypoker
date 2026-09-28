import {
  HttpFinancialCoreClient,
  FinancialCoreError,
  type FinancialCoreClient,
  type TableSettlementRequest,
} from '../../src/core/financial-core-client';
import { ChipDenominatedFc } from '../../src/live/fc-chip-adapter';

const baseReq: TableSettlementRequest = {
  roundId: 'round-1',
  tableType: 'PLATFORM',
  losers: [{ playerAccountId: 'p1', amount: '10' }],
  winners: [{ playerAccountId: 'p2', amount: '9' }],
  rake: '1',
  jackpot: { mini: '0', minor: '0', major: '0', grand: '0' },
  jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
};

describe('HttpFinancialCoreClient.settleTableHand', () => {
  // BUG-01: game-server never retries a settlement, so applied:false can only mean the roundId was
  // already used — a reused idempotency key, not a legitimate no-op. Swallowing it let chips move
  // locally while the ledger silently skipped the transfer.
  it('throws when the server reports applied:false', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({ roundId: baseReq.roundId, applied: false }),
    })) as unknown as typeof fetch;

    const client = new HttpFinancialCoreClient({
      baseUrl: 'http://fc.test',
      internalSecret: 'secret',
      fetchImpl,
    });

    await expect(client.settleTableHand(baseReq)).rejects.toThrow(FinancialCoreError);
    await expect(client.settleTableHand(baseReq)).rejects.toThrow(/round id reused/);
  });

  it('resolves normally when the server reports applied:true', async () => {
    const fetchImpl = (async (url: unknown) => {
      const path = String(url);
      if (path.includes('/internal/notifications') || path.includes('/internal/volume')) {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ roundId: baseReq.roundId, applied: true }) };
    }) as unknown as typeof fetch;

    const client = new HttpFinancialCoreClient({
      baseUrl: 'http://fc.test',
      internalSecret: 'secret',
      fetchImpl,
    });

    const result = await client.settleTableHand(baseReq);
    expect(result).toEqual({ roundId: baseReq.roundId, applied: true });
  });
});

/**
 * BUG-10 follow-up: slots-room's vendor float top-up (`ensureVendorFunded`) needs to read what the
 * vendor account already has locked, so it can buy in only the shortfall instead of piling a fresh
 * float on top of one it locked last boot. This is the HTTP-client half of that plumbing — the FC
 * route (`GET /internal/accounts/:id/balance`) already reports `locked`; this just consumes it.
 */
describe('HttpFinancialCoreClient.lockedBalance', () => {
  it('returns the locked field from the balance endpoint, unconverted', async () => {
    let requestedUrl = '';
    const fetchImpl = (async (url: unknown) => {
      requestedUrl = String(url);
      return { ok: true, json: async () => ({ accountId: 'acc-1', available: '10.00', locked: '25.50', clearing: '0.00' }) };
    }) as unknown as typeof fetch;

    const client = new HttpFinancialCoreClient({
      baseUrl: 'http://fc.test',
      internalSecret: 'secret',
      fetchImpl,
    });

    const locked = await client.lockedBalance('acc-1');
    expect(locked).toBe('25.50');
    expect(requestedUrl).toBe('http://fc.test/internal/accounts/acc-1/balance');
  });

  it('throws FinancialCoreError on a non-ok response', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 500, text: async () => 'boom' })) as unknown as typeof fetch;
    const client = new HttpFinancialCoreClient({ baseUrl: 'http://fc.test', internalSecret: 'secret', fetchImpl });
    await expect(client.lockedBalance('acc-1')).rejects.toThrow(FinancialCoreError);
  });
});

/**
 * `ChipDenominatedFc` is the boundary between chip-speaking rooms and the USDT-speaking FC. Every
 * other amount it forwards is converted at this exact seam (chip-currency.ts); `lockedBalance` is a
 * read going the other way — USDT in from the inner client, chips out to the room — and needs the
 * same one-boundary treatment or a room reading it would be off by the chip/cent rate.
 */
describe('ChipDenominatedFc.lockedBalance', () => {
  it('converts the inner USDT locked balance to whole chips', async () => {
    const inner: FinancialCoreClient = {
      buyIn: async () => {},
      release: async () => {},
      settleRound: async () => {
        throw new Error('not used');
      },
      settleTableHand: async () => ({ roundId: 'x', applied: true }),
      lockedBalance: async (accountId: string) => {
        expect(accountId).toBe('acc-vendor');
        return '40.00'; // USDT
      },
    };
    const fc = new ChipDenominatedFc(inner);
    // $0.01 = 1 chip (chip-currency.ts), so $40.00 locked is 4,000 chips.
    await expect(fc.lockedBalance('acc-vendor')).resolves.toBe('4000');
  });

  it('reports "0" when the inner client has no lockedBalance at all', async () => {
    const inner: FinancialCoreClient = {
      buyIn: async () => {},
      release: async () => {},
      settleRound: async () => {
        throw new Error('not used');
      },
      settleTableHand: async () => ({ roundId: 'x', applied: true }),
    };
    const fc = new ChipDenominatedFc(inner);
    await expect(fc.lockedBalance('acc-vendor')).resolves.toBe('0');
  });
});
