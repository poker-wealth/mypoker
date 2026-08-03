import {
  ResilientProvider,
  ProviderUnavailableError,
} from '../../../src/games/third-party/resilient-provider';
import {
  ThirdPartyAdapter,
  signResult,
  type RoundRequest,
  type SignedRoundResult,
  type ThirdPartyProvider,
} from '../../../src/games/third-party/adapter';
import type { FinancialCoreClient } from '../../../src/core/financial-core-client';

const SECRET = 's';

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
beforeEach(() => {
  settleCalls = 0;
});

/** A vendor we can switch between healthy, broken, and hanging. */
class FlakyVendor implements ThirdPartyProvider {
  calls = 0;
  mode: 'ok' | 'throw' | 'hang' = 'ok';
  constructor(readonly name = 'lottery') {}
  async playRound(req: RoundRequest): Promise<SignedRoundResult> {
    this.calls++;
    if (this.mode === 'throw') throw new Error('ECONNREFUSED');
    if (this.mode === 'hang') await new Promise(() => {}); // never resolves
    const payout = req.wager * 2;
    return {
      result: { roundId: req.roundId, payout, outcome: {} },
      signature: signResult(SECRET, { ...req, payout }),
    };
  }
}

let clock = 0;
const wrap = (v: ThirdPartyProvider): ResilientProvider =>
  new ResilientProvider(v, {
    timeoutMs: 50,
    failureThreshold: 3,
    cooldownMs: 1000,
    now: () => clock,
  });

const adapterFor = (p: ThirdPartyProvider): ThirdPartyAdapter =>
  new ThirdPartyAdapter(fc, {
    provider: p,
    secret: SECRET,
    providerAccountId: 'acc-vendor',
    maxPayoutMultiple: 100,
    commissionBps: 0,
    tableType: 'PLATFORM',
    accountOf: (x) => `acc-${x}`,
    jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
  });

beforeEach(() => {
  clock = 0;
});

describe('vendor outage never reaches the Financial Core', () => {
  it('a vendor that errors produces ZERO FC calls — not failed ones', async () => {
    const vendor = new FlakyVendor();
    vendor.mode = 'throw';
    const a = adapterFor(wrap(vendor));

    await expect(a.play('p1', 'r1', 100)).rejects.toThrow(ProviderUnavailableError);
    expect(settleCalls).toBe(0); // the FC was never asked to do anything
  });

  it('a vendor that hangs times out instead of stalling the table', async () => {
    const vendor = new FlakyVendor();
    vendor.mode = 'hang';
    const a = adapterFor(wrap(vendor));

    await expect(a.play('p1', 'r1', 100)).rejects.toThrow(/temporarily unavailable/);
    expect(settleCalls).toBe(0);
  });

  it('the round is not marked settled, so it can be retried once the vendor recovers', async () => {
    const vendor = new FlakyVendor();
    const resilient = wrap(vendor);
    const a = adapterFor(resilient);

    vendor.mode = 'throw';
    await expect(a.play('p1', 'r1', 100)).rejects.toThrow(ProviderUnavailableError);
    expect(a.getReceipt('r1')).toBeUndefined();

    vendor.mode = 'ok';
    const r = await a.play('p1', 'r1', 100);
    expect(r.payout).toBe(200);
    expect(settleCalls).toBe(1);
  });
});

describe('circuit breaker', () => {
  it('opens after the failure threshold and then fails fast without calling the vendor', async () => {
    const vendor = new FlakyVendor();
    vendor.mode = 'throw';
    const p = wrap(vendor);

    for (let i = 0; i < 3; i++) await expect(p.playRound({ roundId: `r${i}`, playerId: 'p', wager: 1 })).rejects.toThrow();
    expect(p.getState()).toBe('OPEN');
    expect(p.isAvailable()).toBe(false); // lobby greys the game out

    const callsBefore = vendor.calls;
    await expect(p.playRound({ roundId: 'rx', playerId: 'p', wager: 1 })).rejects.toThrow(/circuit open/);
    expect(vendor.calls).toBe(callsBefore); // we did not even dial a vendor we know is down
  });

  it('probes after the cooldown and closes again when the vendor recovers', async () => {
    const vendor = new FlakyVendor();
    vendor.mode = 'throw';
    const p = wrap(vendor);
    for (let i = 0; i < 3; i++) await expect(p.playRound({ roundId: `r${i}`, playerId: 'p', wager: 1 })).rejects.toThrow();
    expect(p.getState()).toBe('OPEN');

    clock += 1000; // cooldown elapses
    expect(p.getState()).toBe('HALF_OPEN');
    expect(p.isAvailable()).toBe(true);

    vendor.mode = 'ok';
    await p.playRound({ roundId: 'ok1', playerId: 'p', wager: 1 });
    expect(p.getState()).toBe('CLOSED'); // healthy again
  });

  it('a failed probe re-opens the breaker immediately', async () => {
    const vendor = new FlakyVendor();
    vendor.mode = 'throw';
    const p = wrap(vendor);
    for (let i = 0; i < 3; i++) await expect(p.playRound({ roundId: `r${i}`, playerId: 'p', wager: 1 })).rejects.toThrow();

    clock += 1000;
    expect(p.getState()).toBe('HALF_OPEN');
    await expect(p.playRound({ roundId: 'probe', playerId: 'p', wager: 1 })).rejects.toThrow();
    expect(p.getState()).toBe('OPEN'); // still down — back to failing fast
  });
});

describe('vendors are isolated from each other', () => {
  it('Lottery going down leaves Slots working', async () => {
    const lottery = new FlakyVendor('lottery');
    const slots = new FlakyVendor('slots');
    lottery.mode = 'throw';
    const lotteryP = wrap(lottery);
    const slotsP = wrap(slots);

    for (let i = 0; i < 3; i++)
      await expect(adapterFor(lotteryP).play('p', `l${i}`, 100)).rejects.toThrow(ProviderUnavailableError);
    expect(lotteryP.isAvailable()).toBe(false);

    // Slots is untouched: still available, still settles.
    expect(slotsP.isAvailable()).toBe(true);
    const r = await adapterFor(slotsP).play('p', 's1', 100);
    expect(r.payout).toBe(200);
    expect(settleCalls).toBe(1); // the only FC call came from the healthy vendor
  });
});
