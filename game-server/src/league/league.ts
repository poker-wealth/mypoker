/**
 * League system (FairPlay v5.9 §2, §2.1) — a league runs its own economy, inside walls the platform
 * sets and a league can never move.
 *
 * A league is AUTONOMOUS over: rake rate (within a platform min/max), table hours, buy-in
 * requirements, and whether spectating is allowed.
 *
 * The rake rate is autonomous but NOT immediate. The 16-milestone plan: "Rake rate change: 7-day
 * transition period enforced by platform (cannot apply early)", with the acceptance test spelled out
 * as "attempt to apply rake change immediately -> rejected, scheduled for +7 days". So a rake change
 * is scheduled, never applied on the spot, and the platform — not the league — holds the clock. The
 * reason is players: someone sitting at a table chose to sit down at a known rake, and a league that
 * could raise it mid-session would be changing the price after the sale.
 *
 * The platform keeps FINAL, NON-NEGOTIABLE risk control: account bans after confirmed collusion,
 * freezing funds on abnormal withdrawals, and the anti-bot single-table limit. §2.1 is explicit that
 * a league may NOT contract out of these ("no soft-play-among-friends exemption"), so the override is
 * enforced in code (`platformRiskControlWins`) rather than left to a signed promise.
 */

/** The platform's bounds on what a league may choose. */
export interface PlatformLeaguePolicy {
  minRakeBps: number;
  maxRakeBps: number;
  maxTableHours: number;
  minBuyIn: number;
  maxBuyIn: number;
}

export interface LeagueSettings {
  rakeBps: number;
  /** Hours per day the league's tables may run. */
  tableHours: number;
  buyIn: number;
  spectatorsAllowed: boolean;
}

/**
 * The platform-enforced waiting period on a rake change (16-milestone plan, W-league §self-service).
 * Not a league setting — a league cannot shorten it, which is the entire point of "enforced by
 * platform (cannot apply early)".
 */
export const RAKE_CHANGE_TRANSITION_DAYS = 7;
const RAKE_CHANGE_TRANSITION_MS = RAKE_CHANGE_TRANSITION_DAYS * 24 * 60 * 60 * 1000;

/** A rake change that has been accepted but is not yet in force. */
export interface PendingRakeChange {
  rakeBps: number;
  /** Epoch ms. The platform sets this; nothing a league sends can move it earlier. */
  effectiveAt: number;
}

/**
 * A league's settings plus any rake change still in its transition period.
 *
 * Modelled as one value rather than two so a caller cannot read the settings and forget the pending
 * change — the bug that shape invites is charging the old rake after the new one came into force.
 */
export interface LeagueSettingsState {
  /** In force right now. */
  settings: LeagueSettings;
  pendingRakeChange: PendingRakeChange | null;
}

export class LeagueRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeagueRuleError';
  }
}

/** A league's chosen settings must sit inside the platform's bounds. Any breach is rejected. */
export function validateSettings(policy: PlatformLeaguePolicy, s: LeagueSettings): void {
  if (s.rakeBps < policy.minRakeBps || s.rakeBps > policy.maxRakeBps) {
    throw new LeagueRuleError(
      `rake ${s.rakeBps / 100}% is outside the platform range ${policy.minRakeBps / 100}–${policy.maxRakeBps / 100}%`,
    );
  }
  if (s.tableHours <= 0 || s.tableHours > policy.maxTableHours) {
    throw new LeagueRuleError(`table hours must be 1–${policy.maxTableHours}`);
  }
  if (s.buyIn < policy.minBuyIn || s.buyIn > policy.maxBuyIn) {
    throw new LeagueRuleError('buy-in is outside the platform range');
  }
}

// ── Rake-rate transition (7 days, platform-enforced) ─────────────────────────

/**
 * Accept a settings change from a league.
 *
 * Everything except the rake takes effect at once — the doc only puts a transition on the rate.
 * A changed rake is validated NOW (an out-of-band rate is refused outright, never parked in a
 * queue to fail later) and scheduled for +7 days.
 *
 * Two details that decide whether the rule is enforceable rather than decorative:
 *
 *   RE-REQUESTING RESTARTS THE CLOCK. Otherwise a league schedules 3% for next Tuesday, then
 *   re-requests 3% on Monday and argues the transition is nearly served. Each request is a new
 *   change and waits its own 7 days.
 *
 *   REVERTING CANCELS. Asking for the rate already in force means the league changed its mind, so
 *   the pending change is dropped rather than "scheduled" — scheduling a no-op would leave a
 *   phantom change that later overwrites a real one.
 */
export function requestSettingsChange(
  policy: PlatformLeaguePolicy,
  state: LeagueSettingsState,
  next: LeagueSettings,
  now: number,
): { state: LeagueSettingsState; rakeScheduledFor: number | null } {
  validateSettings(policy, next);

  // Non-rake settings apply immediately; the rake in force does NOT change here.
  const applied: LeagueSettings = { ...next, rakeBps: state.settings.rakeBps };

  if (next.rakeBps === state.settings.rakeBps) {
    return { state: { settings: applied, pendingRakeChange: null }, rakeScheduledFor: null };
  }

  const effectiveAt = now + RAKE_CHANGE_TRANSITION_MS;
  return {
    state: { settings: applied, pendingRakeChange: { rakeBps: next.rakeBps, effectiveAt } },
    rakeScheduledFor: effectiveAt,
  };
}

/**
 * The settings actually in force at `now`, with a due rake change folded in.
 *
 * Read-only: it does not mutate or promote anything, so it is safe to call on every hand. Callers
 * that need the promotion persisted use `promoteDueRakeChange`.
 */
export function effectiveSettings(
  state: LeagueSettingsState,
  now: number,
  policy?: PlatformLeaguePolicy,
): LeagueSettings {
  const p = state.pendingRakeChange;
  if (!p || now < p.effectiveAt) return { ...state.settings };
  // If the platform narrowed its band during the transition, the scheduled rate is no longer legal
  // and the OLD rate stands. A league must not acquire an out-of-band rake by having asked for it
  // back when it was allowed.
  if (policy && (p.rakeBps < policy.minRakeBps || p.rakeBps > policy.maxRakeBps)) {
    return { ...state.settings };
  }
  return { ...state.settings, rakeBps: p.rakeBps };
}

/**
 * Fold a due rake change into the settings, for persisting.
 *
 * Returns the same state untouched when nothing is due, so a caller can write unconditionally and a
 * no-op costs one comparison. A change that has become illegal is DROPPED, not applied — see above.
 */
export function promoteDueRakeChange(
  state: LeagueSettingsState,
  now: number,
  policy?: PlatformLeaguePolicy,
): { state: LeagueSettingsState; promoted: boolean; dropped: boolean } {
  const p = state.pendingRakeChange;
  if (!p || now < p.effectiveAt) return { state, promoted: false, dropped: false };

  if (policy && (p.rakeBps < policy.minRakeBps || p.rakeBps > policy.maxRakeBps)) {
    return { state: { ...state, pendingRakeChange: null }, promoted: false, dropped: true };
  }
  return {
    state: { settings: { ...state.settings, rakeBps: p.rakeBps }, pendingRakeChange: null },
    promoted: true,
    dropped: false,
  };
}

// ── Platform risk control — non-negotiable (§2.1) ─────────────────────────────

/**
 * The controls a league can NEVER opt out of. Named explicitly so the ban is greppable, and so a
 * "the league admin turned it off" bug is impossible: these are not league settings at all.
 */
export const PLATFORM_RISK_CONTROLS = [
  'BAN_ON_CONFIRMED_COLLUSION',
  'FREEZE_ABNORMAL_WITHDRAWAL',
  'ANTI_BOT_SINGLE_TABLE_LIMIT',
] as const;
export type PlatformRiskControl = (typeof PLATFORM_RISK_CONTROLS)[number];

/**
 * When a league preference and a platform risk control disagree, the platform wins — always. There
 * is no `leagueOverride` parameter, by design: a league cannot pass one because it cannot have one.
 */
export function platformRiskControlWins(_control: PlatformRiskControl): 'PLATFORM_ENFORCES' {
  return 'PLATFORM_ENFORCES';
}

/**
 * A league agreement can never carry a risk-control exemption. This rejects any attempt to sign one
 * (e.g. "soft play among friends is allowed here").
 */
export function assertNoRiskControlExemption(requestedExemptions: readonly string[]): void {
  const forbidden = requestedExemptions.filter((e) =>
    (PLATFORM_RISK_CONTROLS as readonly string[]).includes(e),
  );
  if (forbidden.length > 0) {
    throw new LeagueRuleError(
      `a league cannot be exempted from platform risk control: ${forbidden.join(', ')}`,
    );
  }
}

export class League {
  private state: LeagueSettingsState;

  constructor(
    readonly leagueId: string,
    readonly policy: PlatformLeaguePolicy,
    settings: LeagueSettings,
    pendingRakeChange: PendingRakeChange | null = null,
  ) {
    validateSettings(policy, settings);
    this.state = { settings, pendingRakeChange };
  }

  /** The settings in force at `now`, with a due rake change folded in. */
  getSettings(now: number = Date.now()): LeagueSettings {
    return effectiveSettings(this.state, now, this.policy);
  }

  /** The full state, including any change still in transition — for persisting. */
  getState(): LeagueSettingsState {
    return { settings: { ...this.state.settings }, pendingRakeChange: this.state.pendingRakeChange };
  }

  /**
   * A league may change its own settings — inside platform bounds, and a rake change waits.
   *
   * This used to assign `next` wholesale, which applied a new rake the instant it was asked for. The
   * doc forbids exactly that: "attempt to apply rake change immediately -> rejected, scheduled for
   * +7 days". Returns when the new rate lands, or null when the rake was untouched, so a caller can
   * tell the league what actually happened instead of implying the change is live.
   */
  updateSettings(next: LeagueSettings, now: number = Date.now()): { rakeScheduledFor: number | null } {
    const result = requestSettingsChange(this.policy, this.state, next, now);
    this.state = result.state;
    return { rakeScheduledFor: result.rakeScheduledFor };
  }

  /** Any rake change not yet in force. */
  getPendingRakeChange(): PendingRakeChange | null {
    return this.state.pendingRakeChange;
  }

  /** League rake goes 100% to League Inventory — never the platform Treasury. */
  rakeDestination(): 'LEAGUE_INVENTORY' {
    return 'LEAGUE_INVENTORY';
  }
}
