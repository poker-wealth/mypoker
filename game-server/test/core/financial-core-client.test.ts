import {
  HttpFinancialCoreClient,
  FinancialCoreError,
  type TableSettlementRequest,
} from '../../src/core/financial-core-client';

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
