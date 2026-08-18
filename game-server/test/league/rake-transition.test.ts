import {
  League,
  LeagueRuleError,
  RAKE_CHANGE_TRANSITION_DAYS,
  effectiveSettings,
  promoteDueRakeChange,
  requestSettingsChange,
  type LeagueSettings,
  type LeagueSettingsState,
  type PlatformLeaguePolicy,
} from '../../src/league/league';

/**
 * The 7-day rake transition (16-milestone plan, league self-service).
 *
 * The doc: "Rake rate change: 7-day transition period enforced by platform
 * (cannot apply early)", with the acceptance criterion written out as "attempt
 * to apply rake change immediately -> rejected, scheduled for +7 days".
 *
 * The rule protects players, not the platform. Someone sat down at a table
 * having been told a rake; a league that could raise it mid-session would be
 * changing the price after the sale. So the interesting cases here are all the
 * ways a league might try to make the wait shorter than seven days.
 *
 * No fake timers: `now` is a parameter throughout, so these are ordinary
 * arithmetic assertions rather than a fight with the clock.
 */

const policy: PlatformLeaguePolicy = {
  minRakeBps: 100,
  maxRakeBps: 700,
  maxTableHours: 24,
  minBuyIn: 100,
  maxBuyIn: 10_000,
};

const base: LeagueSettings = { rakeBps: 500, tableHours: 12, buyIn: 400, spectatorsAllowed: true };
const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const SEVEN_DAYS = RAKE_CHANGE_TRANSITION_DAYS * DAY;

const fresh = (): LeagueSettingsState => ({ settings: { ...base }, pendingRakeChange: null });

describe('a rake change waits 7 days', () => {
  it('does not apply on the spot', () => {
    const { state } = requestSettingsChange(policy, fresh(), { ...base, rakeBps: 300 }, T0);
    expect(effectiveSettings(state, T0, policy).rakeBps).toBe(500);
  });

  it('is scheduled exactly 7 days out', () => {
    const { rakeScheduledFor } = requestSettingsChange(policy, fresh(), { ...base, rakeBps: 300 }, T0);
    expect(rakeScheduledFor).toBe(T0 + SEVEN_DAYS);
  });

  it('is still not in force one millisecond early', () => {
    // The boundary, not a comfortable midpoint: an inclusive/exclusive slip here
    // would hand a league its new rake a whole day sooner and no test would notice.
    const { state } = requestSettingsChange(policy, fresh(), { ...base, rakeBps: 300 }, T0);
    expect(effectiveSettings(state, T0 + SEVEN_DAYS - 1, policy).rakeBps).toBe(500);
  });

  it('is in force at exactly 7 days', () => {
    const { state } = requestSettingsChange(policy, fresh(), { ...base, rakeBps: 300 }, T0);
    expect(effectiveSettings(state, T0 + SEVEN_DAYS, policy).rakeBps).toBe(300);
  });

  it('applies a raise on the same terms as a cut', () => {
    // A cut arriving late merely annoys the league; a RAISE arriving early costs
    // players money, so the direction must not change the timing.
    const { state } = requestSettingsChange(policy, fresh(), { ...base, rakeBps: 700 }, T0);
    expect(effectiveSettings(state, T0 + SEVEN_DAYS - 1, policy).rakeBps).toBe(500);
    expect(effectiveSettings(state, T0 + SEVEN_DAYS, policy).rakeBps).toBe(700);
  });
});

describe('the wait cannot be shortened', () => {
  it('restarts the clock when the same change is re-requested', () => {
    // Otherwise: schedule 3% on day 0, re-request 3% on day 6, and claim six
    // days of the transition are already served.
    const first = requestSettingsChange(policy, fresh(), { ...base, rakeBps: 300 }, T0);
    const second = requestSettingsChange(policy, first.state, { ...base, rakeBps: 300 }, T0 + 6 * DAY);

    expect(second.rakeScheduledFor).toBe(T0 + 6 * DAY + SEVEN_DAYS);
    // Day 7 from the FIRST request is no longer enough.
    expect(effectiveSettings(second.state, T0 + SEVEN_DAYS, policy).rakeBps).toBe(500);
  });

  it('restarts the clock when the target changes mid-transition', () => {
    const first = requestSettingsChange(policy, fresh(), { ...base, rakeBps: 300 }, T0);
    const second = requestSettingsChange(policy, first.state, { ...base, rakeBps: 400 }, T0 + DAY);

    expect(second.state.pendingRakeChange).toEqual({
      rakeBps: 400,
      effectiveAt: T0 + DAY + SEVEN_DAYS,
    });
    expect(effectiveSettings(second.state, T0 + SEVEN_DAYS, policy).rakeBps).toBe(500);
  });

  it('cancels rather than schedules when the league reverts', () => {
    // Asking for the rate already in force is a change of mind. Scheduling a
    // no-op would leave a phantom pending change that later overwrites a real one.
    const scheduled = requestSettingsChange(policy, fresh(), { ...base, rakeBps: 300 }, T0);
    const reverted = requestSettingsChange(policy, scheduled.state, { ...base, rakeBps: 500 }, T0 + DAY);

    expect(reverted.state.pendingRakeChange).toBeNull();
    expect(reverted.rakeScheduledFor).toBeNull();
    expect(effectiveSettings(reverted.state, T0 + 30 * DAY, policy).rakeBps).toBe(500);
  });
});

describe('the band is enforced at both ends of the transition', () => {
  it('refuses an out-of-band rate outright rather than queueing it', () => {
    // Parking an illegal rate for a week, to fail on arrival, would tell the
    // league it succeeded and surprise everyone seven days later.
    expect(() => requestSettingsChange(policy, fresh(), { ...base, rakeBps: 900 }, T0)).toThrow(
      LeagueRuleError,
    );
  });

  it('drops a scheduled rate the platform has since made illegal', () => {
    const { state } = requestSettingsChange(policy, fresh(), { ...base, rakeBps: 700 }, T0);
    // The platform narrows the band during the transition.
    const narrowed: PlatformLeaguePolicy = { ...policy, maxRakeBps: 600 };

    expect(effectiveSettings(state, T0 + SEVEN_DAYS, narrowed).rakeBps).toBe(500);
    const promoted = promoteDueRakeChange(state, T0 + SEVEN_DAYS, narrowed);
    expect(promoted.dropped).toBe(true);
    expect(promoted.promoted).toBe(false);
    expect(promoted.state.pendingRakeChange).toBeNull();
    expect(promoted.state.settings.rakeBps).toBe(500);
  });
});

describe('non-rake settings are not delayed', () => {
  it('applies hours, buy-in and spectators immediately', () => {
    const { state } = requestSettingsChange(
      policy,
      fresh(),
      { rakeBps: 300, tableHours: 6, buyIn: 1000, spectatorsAllowed: false },
      T0,
    );
    const now = effectiveSettings(state, T0, policy);
    expect(now.tableHours).toBe(6);
    expect(now.buyIn).toBe(1000);
    expect(now.spectatorsAllowed).toBe(false);
    // ...while the rake alone waits.
    expect(now.rakeBps).toBe(500);
  });
});

describe('promotion is safe to run on a schedule', () => {
  it('is a no-op before the change is due', () => {
    const { state } = requestSettingsChange(policy, fresh(), { ...base, rakeBps: 300 }, T0);
    const r = promoteDueRakeChange(state, T0 + DAY, policy);
    expect(r.promoted).toBe(false);
    expect(r.state).toBe(state); // same object: a sweep over idle leagues costs nothing
  });

  it('folds the change in exactly once', () => {
    const { state } = requestSettingsChange(policy, fresh(), { ...base, rakeBps: 300 }, T0);
    const first = promoteDueRakeChange(state, T0 + SEVEN_DAYS, policy);
    expect(first.promoted).toBe(true);
    expect(first.state.settings.rakeBps).toBe(300);
    expect(first.state.pendingRakeChange).toBeNull();

    // Running again must not re-apply or resurrect anything.
    const second = promoteDueRakeChange(first.state, T0 + 30 * DAY, policy);
    expect(second.promoted).toBe(false);
    expect(second.state.settings.rakeBps).toBe(300);
  });
});

describe('the League class enforces it too', () => {
  it('reports when the new rate lands, and keeps charging the old one until then', () => {
    const league = new League('lg1', policy, { ...base });
    const { rakeScheduledFor } = league.updateSettings({ ...base, rakeBps: 250 }, T0);

    expect(rakeScheduledFor).toBe(T0 + SEVEN_DAYS);
    expect(league.getSettings(T0).rakeBps).toBe(500);
    expect(league.getSettings(T0 + SEVEN_DAYS).rakeBps).toBe(250);
    expect(league.getPendingRakeChange()).toEqual({ rakeBps: 250, effectiveAt: T0 + SEVEN_DAYS });
  });

  it('returns null when the rake was untouched', () => {
    const league = new League('lg1', policy, { ...base });
    expect(league.updateSettings({ ...base, tableHours: 8 }, T0).rakeScheduledFor).toBeNull();
  });

  it('still sends league rake to League Inventory, never the Treasury', () => {
    // v5.9: "League Private Rooms ... rake -> League Inventory 100%".
    expect(new League('lg1', policy, { ...base }).rakeDestination()).toBe('LEAGUE_INVENTORY');
  });
});
