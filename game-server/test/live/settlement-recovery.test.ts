import { confirmSettled, receiptMatchesRequest } from '../../src/live/settlement-recovery';
import type {
  FinancialCoreClient,
  SettlementStatus,
  TableSettlementReceipt,
  TableSettlementRequest,
} from '../../src/core/financial-core-client';

/**
 * BUG-20's own decision logic, tested in isolation from any room: `receiptMatchesRequest` is the
 * byte-for-byte comparison that decides whether FC's stored receipt is genuinely OUR settlement, and
 * `confirmSettled` is every way that comparison can come back "abandon anyway" — no method, a throw,
 * no receipt, or a receipt that does not match.
 */

const baseRequest: TableSettlementRequest = {
  roundId: 'r-1',
  tableType: 'PLATFORM',
  losers: [{ playerAccountId: 'bob', amount: '100' }],
  winners: [{ playerAccountId: 'alice', amount: '95' }],
  rake: '5',
  jackpot: { mini: '0', minor: '0', major: '0', grand: '0' },
  jackpotAccounts: { mini: 'jp-mini', minor: 'jp-minor', major: 'jp-major', grand: 'jp-grand' },
};

const matchingReceipt: TableSettlementReceipt = {
  type: 'table',
  roundId: 'r-1',
  rake: '5',
  jackpotTotal: '0',
  losers: [{ playerAccountId: 'bob', amount: '100' }],
  winners: [{ playerAccountId: 'alice', amount: '95' }],
  hash: 'deadbeef',
};

describe('receiptMatchesRequest', () => {
  it('matches an identical receipt', () => {
    expect(receiptMatchesRequest(matchingReceipt, baseRequest)).toBe(true);
  });

  it('matches when jackpot legs sum to the receipt total, split differently across tiers', () => {
    const req: TableSettlementRequest = {
      ...baseRequest,
      jackpot: { mini: '1', minor: '2', major: '3', grand: '4' },
    };
    const receipt: TableSettlementReceipt = { ...matchingReceipt, jackpotTotal: '10' };
    expect(receiptMatchesRequest(receipt, req)).toBe(true);
  });

  it('rejects a different round id (a reused id, not our round)', () => {
    expect(receiptMatchesRequest({ ...matchingReceipt, roundId: 'r-2' }, baseRequest)).toBe(false);
  });

  it('rejects a different rake', () => {
    expect(receiptMatchesRequest({ ...matchingReceipt, rake: '6' }, baseRequest)).toBe(false);
  });

  it('rejects a different jackpot total', () => {
    expect(receiptMatchesRequest({ ...matchingReceipt, jackpotTotal: '1' }, baseRequest)).toBe(false);
  });

  it('rejects a missing loser', () => {
    expect(receiptMatchesRequest({ ...matchingReceipt, losers: [] }, baseRequest)).toBe(false);
  });

  it('rejects a loser with a different amount', () => {
    const receipt: TableSettlementReceipt = {
      ...matchingReceipt,
      losers: [{ playerAccountId: 'bob', amount: '99' }],
    };
    expect(receiptMatchesRequest(receipt, baseRequest)).toBe(false);
  });

  it('rejects an extra winner the request never sent', () => {
    const receipt: TableSettlementReceipt = {
      ...matchingReceipt,
      winners: [...matchingReceipt.winners, { playerAccountId: 'carol', amount: '1' }],
    };
    expect(receiptMatchesRequest(receipt, baseRequest)).toBe(false);
  });

  it('rejects a non-table receipt type', () => {
    expect(
      receiptMatchesRequest({ ...matchingReceipt, type: 'other' as 'table' }, baseRequest),
    ).toBe(false);
  });
});

describe('confirmSettled', () => {
  function clientWith(settlementStatus?: FinancialCoreClient['settlementStatus']): FinancialCoreClient {
    return {
      buyIn: jest.fn(),
      release: jest.fn(),
      settleRound: jest.fn(),
      settleTableHand: jest.fn(),
      ...(settlementStatus ? { settlementStatus } : {}),
    } as unknown as FinancialCoreClient;
  }

  it('false when the client has no settlementStatus method at all', async () => {
    const fc = clientWith(undefined);
    expect(await confirmSettled(fc, baseRequest, '[test]')).toBe(false);
  });

  it('false when the status query throws', async () => {
    const fc = clientWith(async () => {
      throw new Error('financial-core unreachable');
    });
    expect(await confirmSettled(fc, baseRequest, '[test]')).toBe(false);
  });

  it('false when FC has no record of the round', async () => {
    const fc = clientWith(async (): Promise<SettlementStatus> => ({ settled: false }));
    expect(await confirmSettled(fc, baseRequest, '[test]')).toBe(false);
  });

  it('false when FC says settled but returns no receipt to verify against', async () => {
    const fc = clientWith(async (): Promise<SettlementStatus> => ({ settled: true }));
    expect(await confirmSettled(fc, baseRequest, '[test]')).toBe(false);
  });

  it('false when the receipt does not match (round id reused)', async () => {
    const fc = clientWith(
      async (): Promise<SettlementStatus> => ({
        settled: true,
        receipt: { ...matchingReceipt, rake: '999' },
      }),
    );
    expect(await confirmSettled(fc, baseRequest, '[test]')).toBe(false);
  });

  it('true when FC confirms the exact request settled', async () => {
    const fc = clientWith(async (): Promise<SettlementStatus> => ({ settled: true, receipt: matchingReceipt }));
    expect(await confirmSettled(fc, baseRequest, '[test]')).toBe(true);
  });
});
