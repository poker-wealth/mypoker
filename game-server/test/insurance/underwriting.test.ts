import {
  underwrite,
  RESERVE_FLOOR,
  MAX_SINGLE_PAYOUT_BPS,
  type UnderwritingSnapshot,
  type InsuranceRequest,
} from '../../src/insurance/underwriting';

/**
 * Two rules here are the ones a review should check hardest: three-way all-ins
 * must skip SILENTLY, and RiskFactor must not appear on the result under any
 * circumstances. Both are stated twice in the spec, which is usually a sign
 * someone got them wrong once already.
 */

const $ = (dollars: number): number => Math.round(dollars * 1_000_000);

const healthy = (over: Partial<UnderwritingSnapshot> = {}): UnderwritingSnapshot => ({
  system: 'PLATFORM',
  reserve: $(100_000),
  reservedExposure: 0,
  inventory: $(50_000),
  reinsurance: $(50_000),
  riskFactor: 1.1,
  ...over,
});

const request = (over: Partial<InsuranceRequest> = {}): InsuranceRequest => ({
  exposure: $(1_000),
  allInPlayers: 2,
  equity: 0.5,
  ...over,
});

describe('the show/skip rule', () => {
  it('activates on a two-player all-in', () => {
    expect(underwrite(healthy(), request()).offered).toBe(true);
  });

  it('skips three or more, and says so as a skip rather than a decline', () => {
    // "3+ silently skips" — the prompt must not appear at all. Appearing and
    // then declining would itself tell the table something about the hand.
    for (const n of [3, 4, 9]) {
      const result = underwrite(healthy(), request({ allInPlayers: n }));
      expect(result.offered).toBe(false);
      expect(result.offered === false && result.reason).toBe('NOT_TWO_PLAYER_ALL_IN');
    }
  });

  it('skips a single all-in too', () => {
    expect(underwrite(healthy(), request({ allInPlayers: 1 })).offered).toBe(false);
  });
});

describe('step 1 — reserve health', () => {
  it('declines below the platform floor of $10,000', () => {
    const result = underwrite(healthy({ reserve: $(9_999) }), request());
    expect(result.offered === false && result.reason).toBe('RESERVE_BELOW_FLOOR');
  });

  it('uses the league floor of $1,000 for a league', () => {
    // A league reserve of $5,000 is below the platform floor but above its own.
    const snapshot = healthy({ system: 'LEAGUE', reserve: $(5_000), inventory: $(5_000), reinsurance: 0 });
    expect(underwrite(snapshot, request({ exposure: $(200) })).offered).toBe(true);

    expect(RESERVE_FLOOR.PLATFORM).toBe($(10_000));
    expect(RESERVE_FLOOR.LEAGUE).toBe($(1_000));
  });
});

describe('step 2 — exposure budget', () => {
  it('declines when the daily budget is fully committed', () => {
    // Daily budget is 15% of $100,000 = $15,000.
    const result = underwrite(healthy({ reservedExposure: $(15_000) }), request());
    expect(result.offered === false && result.reason).toBe('NO_RISK_BUDGET');
  });

  it('caps the payout at what remains of the budget', () => {
    const snapshot = healthy({ reservedExposure: $(14_800) }); // $200 left
    const result = underwrite(snapshot, request({ exposure: $(1_000) }));
    expect(result.offered === true && result.maxPayout).toBe($(200));
  });
});

describe('step 3 — single payout cap', () => {
  it('declines a payout above 5% of reserve', () => {
    // 5% of $100,000 = $5,000.
    const result = underwrite(healthy(), request({ exposure: $(5_001) }));
    expect(result.offered === false && result.reason).toBe('EXCEEDS_SINGLE_PAYOUT_CAP');
  });

  it('allows exactly the cap', () => {
    expect(underwrite(healthy(), request({ exposure: $(5_000) })).offered).toBe(true);
  });

  it('keeps the cap hardcoded at 5%, not configurable', () => {
    // The spec is explicit that this is not admin-configurable. If someone
    // makes it so, this is the test that should stop them.
    expect(MAX_SINGLE_PAYOUT_BPS).toBe(500);
  });
});

describe('step 4 — coverage', () => {
  it('declines when neither inventory nor reinsurance can cover anything', () => {
    const snapshot = healthy({ inventory: 0, reinsurance: 0 });
    const result = underwrite(snapshot, request());
    expect(result.offered === false && result.reason).toBe('INSUFFICIENT_COVERAGE');
  });

  it('draws on reinsurance when inventory alone is short', () => {
    const snapshot = healthy({ inventory: $(100), reinsurance: $(900) });
    const result = underwrite(snapshot, request({ exposure: $(1_000) }));
    expect(result.offered === true && result.maxPayout).toBe($(1_000));
  });
});

describe('step 5 — the quote', () => {
  it('prices from equity, shortened by the risk factor', () => {
    // Fair odds at 50% equity are 2.00; riskFactor 1.1 gives 1.82.
    const result = underwrite(healthy({ riskFactor: 1.1 }), request({ equity: 0.5 }));
    expect(result.offered === true && result.odds).toBe('1.82');
  });

  it('never returns odds below evens', () => {
    // A near-certain hand has no insurable downside worth pricing.
    const result = underwrite(healthy(), request({ equity: 0.99 }));
    expect(result.offered).toBe(false);
  });

  it('derives premium from payout and odds', () => {
    const result = underwrite(healthy({ riskFactor: 1 }), request({ equity: 0.5, exposure: $(1_000) }));
    // Odds 2.00, payout $1,000 → premium $500.
    expect(result.offered === true && result.premium).toBe($(500));
  });
});

describe('RiskFactor never leaves the module', () => {
  it('is absent from a quote', () => {
    const result = underwrite(healthy({ riskFactor: 1.37 }), request());

    // The complete set of fields the UI may receive. If a future change adds
    // riskFactor — or anything the multiplier could be recovered from — this
    // fails, which is the point.
    expect(Object.keys(result).sort()).toEqual(
      ['maxPayout', 'odds', 'offered', 'premium'].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(/risk/i);
  });

  it('is absent from a decline', () => {
    const result = underwrite(healthy({ reserve: 0, riskFactor: 1.37 }), request());
    expect(Object.keys(result).sort()).toEqual(['offered', 'reason'].sort());
    expect(JSON.stringify(result)).not.toMatch(/risk/i);
  });

  it('changes the odds without ever naming itself', () => {
    const a = underwrite(healthy({ riskFactor: 1.1 }), request({ equity: 0.5 }));
    const b = underwrite(healthy({ riskFactor: 1.4 }), request({ equity: 0.5 }));

    expect(a).not.toEqual(b);
    // Worth being honest about the limit of this: odds ARE a function of the
    // multiplier, so anyone who knows their exact equity can approximate it
    // from a quote. Hiding the field does not make it unknowable, and pretending
    // otherwise would be worse than saying so.
    //
    // Which is why the spec protects the STORED value with an HMAC and a
    // reset-to-1.0-plus-alert on mismatch, rather than relying on the quote
    // being opaque. What this module guarantees is narrower and still worth
    // having: the number is never handed over directly.
    expect(Object.keys(a)).not.toContain('riskFactor');
    expect(Object.keys(b)).not.toContain('riskFactor');
  });
});

describe('capacity is assessed before a quote is priced', () => {
  it('declines on reserve health without pricing anything', () => {
    // A quote we could not honour should never be computed, let alone returned.
    const result = underwrite(healthy({ reserve: 0 }), request({ equity: 0.5 }));
    expect(result.offered).toBe(false);
    expect('odds' in result).toBe(false);
  });
});
