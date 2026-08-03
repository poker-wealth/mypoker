import {
  commissionFor,
  assertValidSubAgentRate,
  CommissionRuleError,
} from '../../src/agents/commission';

const USD = 1_000_000;
const usd = (n: number): number => n * USD;
const platformRake = (rake: number, over = {}) =>
  commissionFor({ rake, tableType: 'PLATFORM', ...over });

/** Every split must sum to exactly the rake — no cent invented, none lost. */
function expectConserved(rake: number, s: { platform: number; agent: number; subAgent: number }): void {
  expect(s.platform + s.agent + s.subAgent).toBe(rake);
}

describe('the spec’s worked examples (v5.9 §13.1)', () => {
  it('Example 1 — A sets B to 20%: platform $70 / B $20 / A $10', () => {
    const s = platformRake(usd(100), { subAgentRateBps: 2000 });
    expect(s.platform).toBe(usd(70));
    expect(s.subAgent).toBe(usd(20));
    expect(s.agent).toBe(usd(10)); // A's 30% minus B's 20%
    expectConserved(usd(100), s);
  });

  it('Example 2 — player direct under A: platform $70 / A $30', () => {
    const s = platformRake(usd(100));
    expect(s.platform).toBe(usd(70));
    expect(s.agent).toBe(usd(30)); // full rate, no sub-agent cut
    expect(s.subAgent).toBe(0);
    expectConserved(usd(100), s);
  });

  it('Example 3 — A sets B to 10%: platform $70 / B $10 / A $20', () => {
    const s = platformRake(usd(100), { subAgentRateBps: 1000 });
    expect(s.platform).toBe(usd(70));
    expect(s.subAgent).toBe(usd(10));
    expect(s.agent).toBe(usd(20));
    expectConserved(usd(100), s);
  });

  it('B’s cut always comes out of A, never out of the platform’s 70%', () => {
    for (const rate of [500, 1000, 1500, 2000, 2500]) {
      const s = platformRake(usd(100), { subAgentRateBps: rate });
      expect(s.platform).toBe(usd(70)); // unmoved by B's rate
      expect(s.agent + s.subAgent).toBe(usd(30)); // the agent pool is fixed at 30%
    }
  });
});

describe('VIP linkage (v5.9 §13.2)', () => {
  it('the spec’s V5 example — $2,500 rake → $750 base → $900 with linkage', () => {
    const s = platformRake(usd(2500), { vipLink: 'V5' });
    expect(s.agent).toBe(usd(900)); // 750 × 1.20
    expect(s.vipUplift).toBe(usd(150)); // the extra the platform funds
    expect(s.platform).toBe(usd(1600)); // 2500 − 900: uplift comes from the platform's share
    expectConserved(usd(2500), s);
  });

  it('V4 pays ×1.10, V5 ×1.20, none is ×1.0', () => {
    expect(platformRake(usd(100), { vipLink: 'NONE' }).agent).toBe(usd(30));
    expect(platformRake(usd(100), { vipLink: 'V4' }).agent).toBe(usd(33)); // 30 × 1.10
    expect(platformRake(usd(100), { vipLink: 'V5' }).agent).toBe(usd(36)); // 30 × 1.20
  });

  it('lifts each tier’s OWN portion independently', () => {
    // B at 20% with a V5 player: B 20→24, A 10→12. Platform funds the 6.
    const s = platformRake(usd(100), { subAgentRateBps: 2000, vipLink: 'V5' });
    expect(s.subAgent).toBe(usd(24));
    expect(s.agent).toBe(usd(12));
    expect(s.vipUplift).toBe(usd(6));
    expect(s.platform).toBe(usd(64));
    expectConserved(usd(100), s);
  });
});

describe('IRON RULE — league rake is untouchable', () => {
  it('agents earn NOTHING on a league table, however big the rake', () => {
    const s = commissionFor({ rake: usd(10_000), tableType: 'LEAGUE', subAgentRateBps: 2500 });
    expect(s).toEqual({ platform: 0, agent: 0, subAgent: 0, vipUplift: 0 });
  });

  it('even a V5 player generates no agent commission on a league table', () => {
    const s = commissionFor({ rake: usd(5000), tableType: 'LEAGUE', vipLink: 'V5' });
    expect(s.agent).toBe(0);
    expect(s.subAgent).toBe(0);
  });
});

describe('sub-agent rate bounds', () => {
  it('accepts 5%–25%', () => {
    expect(() => assertValidSubAgentRate(500)).not.toThrow();
    expect(() => assertValidSubAgentRate(2500)).not.toThrow();
  });

  it('rejects below 5% and above 25%', () => {
    expect(() => assertValidSubAgentRate(499)).toThrow(CommissionRuleError);
    expect(() => assertValidSubAgentRate(2501)).toThrow(/5%–25%/);
  });

  it('the agent must retain at least 5% — B can never take the whole 30%', () => {
    // 25% is the ceiling: A keeps 5%. Anything more would leave A with nothing.
    expect(() => assertValidSubAgentRate(2600)).toThrow();
    expect(platformRake(usd(100), { subAgentRateBps: 2500 }).agent).toBe(usd(5));
  });
});

describe('edge cases', () => {
  it('a rake-free hand pays nobody', () => {
    expect(platformRake(0)).toEqual({ platform: 0, agent: 0, subAgent: 0, vipUplift: 0 });
  });

  it('stays conserved on awkward amounts', () => {
    for (const rake of [1, 7, 33, 999, 12_345, 1_000_001]) {
      expectConserved(rake, platformRake(rake, { subAgentRateBps: 1700, vipLink: 'V4' }));
    }
  });
});
