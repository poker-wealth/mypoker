import {
  ThirdPartyAdapter,
  ProviderSecurityError,
  signResult,
  type ThirdPartyProvider,
  type RoundRequest,
  type SignedRoundResult,
} from '../../../src/games/third-party/adapter';
import type { FinancialCoreClient } from '../../../src/core/financial-core-client';

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
