import { computeEquity } from '../../../src/games/texas/equity';
import {
  underwrite,
  isInsuranceEligible,
  type InsuranceScenario,
  type ReserveState,
} from '../../../src/games/texas/underwriting';

describe('equity (cards to come)', () => {
  it('a lock has zero loss probability', () => {
    // Trip aces vs nothing, one card to come — opponent can never win.
    const eq = computeEquity(['As', 'Ad'], ['2c', '3d'], ['Ah', '7d', '9s', 'Tc']);
    expect(eq.losses).toBe(0);
    expect(eq.lossProbability).toBe(0);
  });

  it('counts exact outs (KK vs QQ, only two queens beat us)', () => {
    const eq = computeEquity(['Kh', 'Kd'], ['Qc', 'Qs'], ['2h', '7d', '9s', 'Tc']);
    expect(eq.total).toBe(44); // 52 − 8 known
    expect(eq.losses).toBe(2); // only Qd, Qh make trip queens
    expect(eq.lossProbability).toBeCloseTo(2 / 44, 6);
  });
});

describe('insurance activation', () => {
  it('offered only with exactly 2 all-in and cards to come', () => {
    expect(isInsuranceEligible(2, ['2h', '7d', '9s'])).toBe(true); // flop
    expect(isInsuranceEligible(2, ['2h', '7d', '9s', 'Tc'])).toBe(true); // turn
    expect(isInsuranceEligible(3, ['2h', '7d', '9s'])).toBe(false); // 3+ all-in
    expect(isInsuranceEligible(2, ['2h', '7d', '9s', 'Tc', '4h'])).toBe(false); // river complete
    expect(isInsuranceEligible(2, ['2h', '7d'])).toBe(false); // not enough board
  });
});

describe('5-step underwriting', () => {
  const scenario: InsuranceScenario = {
    insured: ['Kh', 'Kd'],
    opponent: ['Qc', 'Qs'],
    board: ['2h', '7d', '9s', 'Tc'], // turn → insuring the river
    pot: 1000,
    requestedCoverage: 1000,
  };
  const healthy: ReserveState = { reserveBalance: 50_000, dailyBudget: 100_000, reservedExposure: 0 };

  it('produces a quote that exposes odds only — never the RiskFactor', () => {
    const r = underwrite(scenario, healthy);
    expect(r.offered).toBe(true);
    if (!r.offered) return;
    // river cap 50% of 1000 = 500 is the binding constraint.
    expect(r.quote.coverage).toBe(500);
    expect(r.quote.premium).toBeGreaterThan(0);
    expect(r.quote.payoutOdds).toBeGreaterThan(1);
    // The internal risk math must not leak.
    expect(Object.keys(r.quote)).toEqual(['premium', 'coverage', 'payoutOdds']);
    expect(r.quote).not.toHaveProperty('riskFactor');
    expect(r.quote).not.toHaveProperty('lossProbability');
  });

  it('rejects when the reserve is below threshold (step 1)', () => {
    const r = underwrite(scenario, { ...healthy, reserveBalance: 5_000 });
    expect(r).toEqual({ offered: false, reason: 'reserve_below_threshold' });
  });

  it('rejects when the daily exposure budget is exhausted (step 2)', () => {
    const r = underwrite(scenario, { ...healthy, dailyBudget: 100, reservedExposure: 100 });
    expect(r).toEqual({ offered: false, reason: 'exposure_exhausted' });
  });

  it('caps coverage to the smallest binding limit (step 4)', () => {
    // Tiny pot → street cap binds below the requested coverage.
    const r = underwrite({ ...scenario, pot: 200, requestedCoverage: 100_000 }, healthy);
    expect(r.offered).toBe(true);
    if (r.offered) expect(r.quote.coverage).toBe(100); // 50% of 200
  });

  it('does not offer insurance on a lock (no risk)', () => {
    const r = underwrite(
      { insured: ['As', 'Ad'], opponent: ['2c', '3d'], board: ['Ah', '7d', '9s', 'Tc'], pot: 1000, requestedCoverage: 500 },
      healthy,
    );
    expect(r).toEqual({ offered: false, reason: 'no_risk' });
  });
});
