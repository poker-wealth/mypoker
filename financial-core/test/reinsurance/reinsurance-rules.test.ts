import { Money } from '../../src/domain/money';
import {
  capFor,
  clawbackFor,
  clawbackTransferable,
  clawbackDeadline,
  isClawbackExpired,
  backstopAmount,
  assertNoCrossSubsidy,
  assertMultiSig,
  ReinsuranceRuleError,
  type ReinsuranceScope,
} from '../../src/reinsurance/reinsurance-rules';

const usd = (s: string): Money => Money.fromDecimalString(s);
const PLATFORM: ReinsuranceScope = { kind: 'PLATFORM' };
const LEAGUE_A: ReinsuranceScope = { kind: 'LEAGUE', leagueId: 'league-a' };
const LEAGUE_B: ReinsuranceScope = { kind: 'LEAGUE', leagueId: 'league-b' };

describe('cap — 3× historical max single-day payout', () => {
  it('caps the pool at three times the worst day it ever paid', () => {
    expect(capFor(usd('5000')).toString()).toBe(usd('15000').toString());
  });
});

describe('clawback — 20% of monthly insurance NET PROFIT', () => {
  it('sweeps 20% of a profitable month', () => {
    expect(clawbackFor(usd('10000')).toString()).toBe(usd('2000').toString());
  });

  it('a loss-making month claws back NOTHING — we never sweep money the pool did not make', () => {
    expect(clawbackFor(usd('-5000')).isZero()).toBe(true);
    expect(clawbackFor(Money.ZERO).isZero()).toBe(true);
  });

  it('never sweeps past the cap — a full pool leaves the money in insurance, working', () => {
    const maxDay = usd('1000'); // cap = 3000
    // Pool already at 2900 → only 100 of room, even though 20% of profit is 2000.
    expect(clawbackTransferable(usd('10000'), usd('2900'), maxDay).toString()).toBe(usd('100').toString());
    // Pool already full → absorbs nothing.
    expect(clawbackTransferable(usd('10000'), usd('3000'), maxDay).isZero()).toBe(true);
    // Plenty of room → the full 20%.
    expect(clawbackTransferable(usd('10000'), usd('0'), maxDay).toString()).toBe(usd('2000').toString());
  });
});

describe('clawback — 24-month deadline', () => {
  const accrued = new Date('2026-07-14T00:00:00Z');

  it('expires 24 months after it arose', () => {
    expect(clawbackDeadline(accrued).toISOString()).toBe('2028-07-14T00:00:00.000Z');
  });

  it('is live before the deadline and expired after it', () => {
    expect(isClawbackExpired(accrued, new Date('2028-07-13T00:00:00Z'))).toBe(false);
    expect(isClawbackExpired(accrued, new Date('2028-07-15T00:00:00Z'))).toBe(true);
  });
});

describe('no cross-subsidy — platform and league pools are separate', () => {
  it('allows a movement within one scope', () => {
    expect(() => assertNoCrossSubsidy(PLATFORM, PLATFORM)).not.toThrow();
    expect(() => assertNoCrossSubsidy(LEAGUE_A, LEAGUE_A)).not.toThrow();
  });

  it('BLOCKS platform money bailing out a league, and vice versa', () => {
    expect(() => assertNoCrossSubsidy(PLATFORM, LEAGUE_A)).toThrow(ReinsuranceRuleError);
    expect(() => assertNoCrossSubsidy(LEAGUE_A, PLATFORM)).toThrow(/cross-subsidy blocked/);
  });

  it('BLOCKS one league bailing out another', () => {
    expect(() => assertNoCrossSubsidy(LEAGUE_A, LEAGUE_B)).toThrow(/cross-subsidy blocked/);
  });
});

describe('backstop — reinsurance tops insurance up', () => {
  it('covers the shortfall when it has the funds', () => {
    expect(backstopAmount(usd('500'), usd('2000'), PLATFORM, PLATFORM).toString()).toBe(
      usd('500').toString(),
    );
  });

  it('pays only what it holds — it cannot go negative', () => {
    expect(backstopAmount(usd('5000'), usd('800'), PLATFORM, PLATFORM).toString()).toBe(
      usd('800').toString(),
    );
  });

  it('pays nothing when there is no shortfall', () => {
    expect(backstopAmount(usd('0'), usd('2000'), PLATFORM, PLATFORM).isZero()).toBe(true);
    expect(backstopAmount(usd('-100'), usd('2000'), PLATFORM, PLATFORM).isZero()).toBe(true);
  });

  it('refuses to back a different scope', () => {
    expect(() => backstopAmount(usd('500'), usd('2000'), PLATFORM, LEAGUE_A)).toThrow(
      ReinsuranceRuleError,
    );
  });
});

describe('TREASURY → INSURANCE needs multi-sig', () => {
  const at = new Date();

  it('accepts two DISTINCT approvers', () => {
    expect(() =>
      assertMultiSig([
        { approverId: 'alice', at },
        { approverId: 'bob', at },
      ]),
    ).not.toThrow();
  });

  it('rejects a single approver', () => {
    expect(() => assertMultiSig([{ approverId: 'alice', at }])).toThrow(ReinsuranceRuleError);
    expect(() => assertMultiSig([])).toThrow(/distinct approvers/);
  });

  it('rejects one person signing twice — that is not multi-sig', () => {
    expect(() =>
      assertMultiSig([
        { approverId: 'alice', at },
        { approverId: 'alice', at },
      ]),
    ).toThrow(/distinct approvers/);
  });
});
