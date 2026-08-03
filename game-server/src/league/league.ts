/**
 * League system (FairPlay v5.9 §2, §2.1) — a league runs its own economy, inside walls the platform
 * sets and a league can never move.
 *
 * A league is AUTONOMOUS over: rake rate (within a platform min/max), table hours, buy-in
 * requirements, and whether spectating is allowed.
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
  private settings: LeagueSettings;

  constructor(
    readonly leagueId: string,
    readonly policy: PlatformLeaguePolicy,
    settings: LeagueSettings,
  ) {
    validateSettings(policy, settings);
    this.settings = settings;
  }

  getSettings(): LeagueSettings {
    return { ...this.settings };
  }

  /** A league may change its own settings — still inside platform bounds. */
  updateSettings(next: LeagueSettings): void {
    validateSettings(this.policy, next);
    this.settings = next;
  }

  /** League rake goes 100% to League Inventory — never the platform Treasury. */
  rakeDestination(): 'LEAGUE_INVENTORY' {
    return 'LEAGUE_INVENTORY';
  }
}
