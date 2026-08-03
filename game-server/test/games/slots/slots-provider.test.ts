import { createHash } from 'node:crypto';
import {
  SlotsProvider,
  spin,
  multiplierOf,
  MAX_MULTIPLIER,
  type Reels,
} from '../../../src/games/slots/slots-provider';
import { ThirdPartyAdapter } from '../../../src/games/third-party/adapter';
import type { FinancialCoreClient } from '../../../src/core/financial-core-client';

const SECRET = 'slots-secret';

const fc: FinancialCoreClient = {
  async buyIn() {},
  async release() {},
  async settleRound(req) {
    return { roundId: req.roundId, sequence: [], amounts: { jackpot: '0', rake: '0', payout: '0' }, accounts: {}, hash: '' };
  },
  async settleTableHand(req) {
    return { roundId: req.roundId, applied: true };
  },
};

describe('slots — provably fair reels', () => {
  it('the same session seed and round replay the exact same spin', () => {
    expect(spin('seed-A', 'r1')).toEqual(spin('seed-A', 'r1'));
    expect(spin('seed-A', 'r1')).not.toEqual(spin('seed-A', 'r2')); // different round
    expect(spin('seed-A', 'r1')).not.toEqual(spin('seed-B', 'r1')); // different seed
  });

  it('commits to the session seed before any spin, and the reveal verifies', () => {
    const p = new SlotsProvider(SECRET, 'known-seed');
    expect(p.commit()).toBe(createHash('sha256').update('known-seed').digest('hex'));
    expect(createHash('sha256').update(p.revealSeed()).digest('hex')).toBe(p.commit());
  });

  it('pays the paytable', () => {
    expect(multiplierOf(['SEVEN', 'SEVEN', 'SEVEN'])).toBe(40);
    expect(multiplierOf(['STAR', 'STAR', 'STAR'])).toBe(15);
    expect(multiplierOf(['CHERRY', 'CHERRY', 'BELL'])).toBe(1); // two cherries → stake back
    expect(multiplierOf(['BELL', 'STAR', 'SEVEN'])).toBe(0);
  });
});

describe('slots — house edge', () => {
  it('RTP sits below 100% and never exceeds the max multiplier', () => {
    const SPINS = 20_000;
    let paid = 0;
    for (let i = 0; i < SPINS; i++) {
      const m = multiplierOf(spin('rtp-seed', `round-${i}`));
      expect(m).toBeLessThanOrEqual(MAX_MULTIPLIER);
      paid += m;
    }
    const rtp = paid / SPINS;
    // Designed for ~96.8%; must never be a money pump for either side.
    expect(rtp).toBeGreaterThan(0.85);
    expect(rtp).toBeLessThan(1.0);
  });

  it('every symbol appears — no reel is dead', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) spin('cover', `r${i}`).forEach((s) => seen.add(s));
    expect(seen.size).toBe(4);
  });
});

describe('slots — end to end through the isolation boundary', () => {
  const adapter = (seed: string): ThirdPartyAdapter =>
    new ThirdPartyAdapter(fc, {
      provider: new SlotsProvider(SECRET, seed),
      secret: SECRET,
      providerAccountId: 'acc-slots-provider',
      maxPayoutMultiple: 100, // above the 40× top prize
      commissionBps: 0,
      tableType: 'PLATFORM',
      accountOf: (p) => `acc-${p}`,
      jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
    });

  it('settles a spin, and the receipt matches the reels', async () => {
    const a = adapter('e2e-seed');
    const r = await a.play('p1', 'spin-1', 100);
    const reels = spin('e2e-seed', 'spin-1');
    expect(r.payout).toBe(100 * multiplierOf(reels));
    expect(r.net).toBe(r.payout - 100);
    expect((r.outcome as { reels: Reels }).reels).toEqual(reels);
  });

  it('a resubmitted spin never pays twice', async () => {
    const a = adapter('e2e-seed');
    const first = await a.play('p1', 'spin-2', 100);
    const again = await a.play('p1', 'spin-2', 100);
    expect(again.replayed).toBe(true);
    expect(again.payout).toBe(first.payout);
  });
});
