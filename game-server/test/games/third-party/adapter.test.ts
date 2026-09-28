import {
  ThirdPartyAdapter,
  ProviderSecurityError,
  signResult,
  type ThirdPartyProvider,
  type RoundRequest,
  type SignedRoundResult,
} from '../../../src/games/third-party/adapter';
import type { FinancialCoreClient, TableSettlementRequest } from '../../../src/core/financial-core-client';

const SECRET = 'shared-provider-secret';

let settleCalls = 0;
const fc: FinancialCoreClient = {
  async buyIn() {},
  async release() {},
  async settleRound(req) {
    return { roundId: req.roundId, sequence: [], amounts: { jackpot: '0', rake: '0', payout: '0' }, accounts: {}, hash: '' };
  },
  async settleTableHand(req) {
    settleCalls++;
    return { roundId: req.roundId, applied: true };
  },
};

/** A provider we control, so we can make it behave honestly — or maliciously. */
class TestProvider implements ThirdPartyProvider {
  readonly name = 'test';
  constructor(
    private readonly payoutFor: (req: RoundRequest) => number,
    private readonly tamper?: (signed: SignedRoundResult, req: RoundRequest) => SignedRoundResult,
  ) {}
  async playRound(req: RoundRequest): Promise<SignedRoundResult> {
    const payout = this.payoutFor(req);
    const signed: SignedRoundResult = {
      result: { roundId: req.roundId, payout, outcome: { ok: true } },
      signature: signResult(SECRET, { ...req, payout }),
    };
    return this.tamper ? this.tamper(signed, req) : signed;
  }
}

const cfg = {
  secret: SECRET,
  providerAccountId: 'acc-provider',
  maxPayoutMultiple: 100,
  commissionBps: 0,
  tableType: 'PLATFORM' as const,
  accountOf: (p: string) => `acc-${p}`,
  jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
};
const adapter = (provider: ThirdPartyProvider): ThirdPartyAdapter =>
  new ThirdPartyAdapter(fc, { ...cfg, provider });

beforeEach(() => {
  settleCalls = 0;
});

describe('ThirdPartyAdapter — honest provider', () => {
  it('settles a win and a loss, netting player against the provider account', async () => {
    const win = await adapter(new TestProvider(() => 500)).play('p1', 'r1', 100);
    expect(win.payout).toBe(500);
    expect(win.net).toBe(400);

    const loss = await adapter(new TestProvider(() => 0)).play('p1', 'r2', 100);
    expect(loss.net).toBe(-100);
    expect(settleCalls).toBe(2);
  });

  it('a push (payout === wager) moves no money at all', async () => {
    const r = await adapter(new TestProvider(() => 100)).play('p1', 'r3', 100);
    expect(r.net).toBe(0);
    expect(settleCalls).toBe(0);
  });
});

describe('ThirdPartyAdapter — the provider is untrusted', () => {
  it('rejects a forged signature (wrong secret)', async () => {
    const evil = new TestProvider(
      () => 500,
      (s, req) => ({ ...s, signature: signResult('wrong-secret', { ...req, payout: 500 }) }),
    );
    await expect(adapter(evil).play('p1', 'r1', 100)).rejects.toThrow(ProviderSecurityError);
    expect(settleCalls).toBe(0);
  });

  it('rejects a payout inflated after signing', async () => {
    const evil = new TestProvider(
      () => 500,
      (s) => ({ ...s, result: { ...s.result, payout: 5000 } }), // signature still covers 500
    );
    await expect(adapter(evil).play('p1', 'r1', 100)).rejects.toThrow(/invalid provider signature/);
    expect(settleCalls).toBe(0);
  });

  it('rejects a result bound to a different round', async () => {
    const evil = new TestProvider(
      () => 500,
      (s) => ({ ...s, result: { ...s.result, roundId: 'some-other-round' } }),
    );
    await expect(adapter(evil).play('p1', 'r1', 100)).rejects.toThrow(/different round/);
    expect(settleCalls).toBe(0);
  });

  it('enforces the exposure cap even with a valid signature', async () => {
    // Correctly signed, but claims 200× on a 100 wager — over the 100× cap.
    const greedy = new TestProvider(() => 20_000);
    await expect(adapter(greedy).play('p1', 'r1', 100)).rejects.toThrow(/exposure cap/);
    expect(settleCalls).toBe(0);
  });

  it('rejects negative and non-integer payouts', async () => {
    await expect(adapter(new TestProvider(() => -5)).play('p1', 'r1', 100)).rejects.toThrow(
      /non-negative integer/,
    );
    await expect(adapter(new TestProvider(() => 1.5)).play('p1', 'r1', 100)).rejects.toThrow(
      /non-negative integer/,
    );
  });
});

/**
 * BUG-10 follow-up A. `receipt.net` is the PLAYER's net — not what FC actually moves for the
 * PROVIDER'S own account. `providerDelta` must match the settlement request byte-for-byte: the raw
 * amount when the provider is a loser (a player win — no deduction, rake/jackpot only ever come off
 * a WINNER's side), and the rake+jackpot-trimmed amount when the provider is a winner (a player
 * loss).
 */
describe('ThirdPartyAdapter — receipt.providerDelta (BUG-10 follow-up)', () => {
  function adapterCapturing(
    commissionBps: number,
    provider: ThirdPartyProvider,
  ): { adapter: ThirdPartyAdapter; requests: TableSettlementRequest[] } {
    const requests: TableSettlementRequest[] = [];
    const capturingFc: FinancialCoreClient = {
      async buyIn() {},
      async release() {},
      async settleRound(req) {
        return { roundId: req.roundId, sequence: [], amounts: { jackpot: '0', rake: '0', payout: '0' }, accounts: {}, hash: '' };
      },
      async settleTableHand(req) {
        requests.push(req);
        return { roundId: req.roundId, applied: true };
      },
    };
    return { adapter: new ThirdPartyAdapter(capturingFc, { ...cfg, commissionBps, provider }), requests };
  }

  it('is 0 on a push — no settlement is even built', async () => {
    const { adapter: a } = adapterCapturing(500, new TestProvider(() => 100));
    const r = await a.play('p1', 'r-push', 100);
    expect(r.net).toBe(0);
    expect(r.providerDelta).toBe(0);
  });

  it('on a player win, the provider pays the raw net — a loser is never trimmed by rake/jackpot', async () => {
    const { adapter: a, requests } = adapterCapturing(500, new TestProvider(() => 500));
    const r = await a.play('p1', 'r-win', 100);
    expect(r.net).toBe(400);
    expect(r.providerDelta).toBe(-400);
    const loserParty = requests[0]!.losers.find((l) => l.playerAccountId === cfg.providerAccountId);
    expect(loserParty?.amount).toBe('400');
  });

  it('on a player loss, the provider is credited less than the raw loss — rake + jackpot land on its side', async () => {
    const { adapter: a, requests } = adapterCapturing(500, new TestProvider(() => 0));
    const r = await a.play('p1', 'r-loss', 100);
    expect(r.net).toBe(-100);
    // Provider's gross win is the player's 100-chip loss; rake = floor(100×500/10000) = 5,
    // jackpot = floor(100×50/10000) = 0 (default 0.5% jackpot rate) → credited 95, not 100.
    expect(r.providerDelta).toBe(95);
    const winnerParty = requests[0]!.winners.find((w) => w.playerAccountId === cfg.providerAccountId);
    expect(winnerParty?.amount).toBe('95');
  });

  it('providerDelta always equals exactly what the captured request moves for the provider account', async () => {
    for (const payout of [0, 50, 100, 250, 9000]) {
      const { adapter: a, requests } = adapterCapturing(500, new TestProvider(() => payout));
      const r = await a.play('p1', `r-cross-${payout}`, 100);
      const loserAmt = requests[0]?.losers.find((l) => l.playerAccountId === cfg.providerAccountId)?.amount;
      const winnerAmt = requests[0]?.winners.find((w) => w.playerAccountId === cfg.providerAccountId)?.amount;
      const expected = loserAmt !== undefined ? -Number(loserAmt) : winnerAmt !== undefined ? Number(winnerAmt) : 0;
      expect(r.providerDelta).toBe(expected);
    }
  });
});

describe('ThirdPartyAdapter — replay protection', () => {
  it('settles a round exactly once; resubmits return the original receipt', async () => {
    const a = adapter(new TestProvider(() => 500));
    const first = await a.play('p1', 'r1', 100);
    const second = await a.play('p1', 'r1', 100);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.payout).toBe(first.payout);
    expect(settleCalls).toBe(1); // paid once, not twice
  });

  it('rejects a non-positive wager before the provider is even called', async () => {
    let called = false;
    const p = new TestProvider(() => {
      called = true;
      return 0;
    });
    await expect(adapter(p).play('p1', 'r1', 0)).rejects.toThrow(RangeError);
    expect(called).toBe(false);
  });
});
