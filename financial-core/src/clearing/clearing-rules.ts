import { AccountType } from '../domain/account-types';

/**
 * ClearingRules — the clearing-path whitelist (FairPlay §3.3, the core isolation layer).
 *
 * Funds may ONLY flow along whitelisted (fromType → toType) paths. Any non-whitelisted flow is
 * rejected immediately (CB6 — the most important circuit breaker), logged, and alerted.
 *
 * This whitelist is HARDCODED in source — never in the database, never admin-configurable — so
 * operations staff cannot alter the rules. To change a flow you change this file (2-person review).
 */

const A = AccountType;

/** For each source account type, the exhaustive set of permitted destination types. */
export const ALLOWED_FLOWS: Readonly<Record<AccountType, readonly AccountType[]>> = Object.freeze({
  // Players pay rake/bets/premiums/jackpot injections; pay into a league; withdraw to the chain
  // (EXTERNAL); never directly to reinsurance.
  [A.PLAYER]: [
    A.TREASURY,
    A.LEAGUE_INVENTORY,
    A.INSURANCE,
    A.JACKPOT_MINI,
    A.JACKPOT_MINOR,
    A.JACKPOT_MAJOR,
    A.JACKPOT_GRAND,
    A.EXTERNAL,
  ],
  // Treasury pays players (winnings/withdrawals/agent commission), backstops reinsurance, sells league credits.
  // Treasury → Insurance is intentionally NOT here (must go through multi-sig approval, spec §3.3).
  [A.TREASURY]: [A.PLAYER, A.REINSURANCE, A.LEAGUE_INVENTORY],
  // Insurance pays out to players, or requests a reinsurance backstop. Never to treasury.
  [A.INSURANCE]: [A.PLAYER, A.REINSURANCE],
  // Reinsurance backstops insurance, or repays treasury (clawback). Never directly to a player.
  [A.REINSURANCE]: [A.INSURANCE, A.TREASURY],
  // League inventory pays its own table winners, or remits to platform treasury. Never league→league.
  [A.LEAGUE_INVENTORY]: [A.PLAYER, A.TREASURY],
  // Jackpot pools are pay-out only — straight to the player. Never to treasury (no misappropriation).
  [A.JACKPOT_MINI]: [A.PLAYER],
  [A.JACKPOT_MINOR]: [A.PLAYER],
  [A.JACKPOT_MAJOR]: [A.PLAYER],
  [A.JACKPOT_GRAND]: [A.PLAYER],
  // The outside world funds player deposits. (Off-ramp PLAYER→EXTERNAL is whitelisted above.)
  [A.EXTERNAL]: [A.PLAYER],
});

/** Pure predicate: is this fund-flow on the whitelist? */
export function isFlowAllowed(fromType: AccountType, toType: AccountType): boolean {
  return ALLOWED_FLOWS[fromType]?.includes(toType) ?? false;
}
