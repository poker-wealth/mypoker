import {
  League,
  validateSettings,
  assertNoRiskControlExemption,
  platformRiskControlWins,
  PLATFORM_RISK_CONTROLS,
  LeagueRuleError,
  type PlatformLeaguePolicy,
  type LeagueSettings,
} from '../../src/league/league';

const policy: PlatformLeaguePolicy = {
  minRakeBps: 200, // 2%
  maxRakeBps: 700, // 7%
  maxTableHours: 24,
  minBuyIn: 100,
  maxBuyIn: 1_000_000,
};

const ok: LeagueSettings = { rakeBps: 500, tableHours: 12, buyIn: 1000, spectatorsAllowed: true };

describe('league autonomy — bounded by the platform', () => {
  it('accepts settings inside the platform range', () => {
    expect(() => validateSettings(policy, ok)).not.toThrow();
    const league = new League('lg1', policy, ok);
    expect(league.getSettings().rakeBps).toBe(500);
  });

  it('rejects a rake outside the platform min/max', () => {
    expect(() => validateSettings(policy, { ...ok, rakeBps: 100 })).toThrow(/outside the platform range/);
    expect(() => validateSettings(policy, { ...ok, rakeBps: 800 })).toThrow(LeagueRuleError);
  });

  it('rejects out-of-range table hours and buy-in', () => {
    expect(() => validateSettings(policy, { ...ok, tableHours: 25 })).toThrow(/table hours/);
    expect(() => validateSettings(policy, { ...ok, tableHours: 0 })).toThrow(/table hours/);
    expect(() => validateSettings(policy, { ...ok, buyIn: 50 })).toThrow(/buy-in/);
  });

  it('a league may change its own settings, still within bounds', () => {
    const league = new League('lg1', policy, ok);
    const now = 1_700_000_000_000;

    // Non-rake settings apply at once.
    league.updateSettings({ ...ok, rakeBps: 300, spectatorsAllowed: false }, now);
    expect(league.getSettings(now).spectatorsAllowed).toBe(false);

    // The rake does NOT. This assertion used to read `toBe(300)` — it pinned the
    // behaviour the doc forbids ("attempt to apply rake change immediately ->
    // rejected, scheduled for +7 days"), so it passed for as long as the rule
    // was broken and would only have failed once someone fixed it.
    expect(league.getSettings(now).rakeBps).toBe(ok.rakeBps);

    expect(() => league.updateSettings({ ...ok, rakeBps: 999 }, now)).toThrow(LeagueRuleError);
  });

  it('league rake goes 100% to League Inventory, never the platform', () => {
    expect(new League('lg1', policy, ok).rakeDestination()).toBe('LEAGUE_INVENTORY');
  });
});

describe('IRON RULE — platform risk control is non-negotiable', () => {
  it('the platform always wins on a risk control, no override parameter exists', () => {
    for (const control of PLATFORM_RISK_CONTROLS) {
      expect(platformRiskControlWins(control)).toBe('PLATFORM_ENFORCES');
    }
  });

  it('a league agreement CANNOT carry a risk-control exemption', () => {
    // The classic ask: "soft play among friends — turn off collusion bans for our tables."
    expect(() => assertNoRiskControlExemption(['BAN_ON_CONFIRMED_COLLUSION'])).toThrow(
      /cannot be exempted/,
    );
    expect(() => assertNoRiskControlExemption(['FREEZE_ABNORMAL_WITHDRAWAL'])).toThrow(LeagueRuleError);
    expect(() => assertNoRiskControlExemption(['ANTI_BOT_SINGLE_TABLE_LIMIT'])).toThrow(LeagueRuleError);
  });

  it('lists every forbidden exemption requested, not just the first', () => {
    expect(() => assertNoRiskControlExemption([...PLATFORM_RISK_CONTROLS])).toThrow(
      /BAN_ON_CONFIRMED_COLLUSION.*FREEZE_ABNORMAL_WITHDRAWAL.*ANTI_BOT/s,
    );
  });

  it('an ordinary, non-risk exemption is fine (e.g. a cosmetic perk)', () => {
    expect(() => assertNoRiskControlExemption(['CUSTOM_TABLE_THEME'])).not.toThrow();
  });
});
