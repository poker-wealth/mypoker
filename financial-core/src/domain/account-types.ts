/**
 * Core financial enums — the vocabulary of the ledger.
 *
 * These are the spec's hard-isolation primitives (FairPlay §3.1–3.3). Every account is one of
 * nine pool types; every fund movement is one of sixteen ledger types. Nothing outside these
 * sets is allowed to exist in the system.
 */

/** The nine fund-pool types. Each is an independent account with its own on-chain address. */
export enum AccountType {
  /** Player balance. A player may hold separate Platform-wallet and League-wallet accounts (see `scope`). */
  PLAYER = 'PLAYER',
  /** Platform vault: rake income / deposit aggregation / withdrawal exit. */
  TREASURY = 'TREASURY',
  /** Insurance pool: premium source / payout exit. Single payout ≤5% of pool, daily ≤15%. */
  INSURANCE = 'INSURANCE',
  /** Reinsurance backstop. Only accepts Insurance application; no direct withdrawal. */
  REINSURANCE = 'REINSURANCE',
  /** Per-league inventory: top-up source / league rake aggregation. */
  LEAGUE_INVENTORY = 'LEAGUE_INVENTORY',
  /** Per-table Mini jackpot pool (receives 20% of the 0.5% winner-profit injection). Out-only. */
  JACKPOT_MINI = 'JACKPOT_MINI',
  /** Per-table Minor jackpot pool (30%). Out-only. */
  JACKPOT_MINOR = 'JACKPOT_MINOR',
  /** Per-table Major jackpot pool (25%). Out-only. */
  JACKPOT_MAJOR = 'JACKPOT_MAJOR',
  /** Per-table Grand jackpot pool (25%). Out-only. Admin withdrawal PROHIBITED. */
  JACKPOT_GRAND = 'JACKPOT_GRAND',
  /**
   * System boundary account representing the outside world (the chain). NOT a fund pool — it is
   * the double-entry counterparty for on/off-ramps: deposits flow EXTERNAL→PLAYER, withdrawals
   * PLAYER→EXTERNAL. It is allowed to go negative; −balance = total funds players hold on-platform
   * (the on-chain reserve the platform must custody). Spec §3.9 refers to this as `external`.
   */
  EXTERNAL = 'EXTERNAL',
}

export const ACCOUNT_TYPES: readonly AccountType[] = Object.values(AccountType);

/** Owner id of the singleton EXTERNAL boundary account. */
export const WORLD_OWNER = 'WORLD';

export const JACKPOT_ACCOUNT_TYPES: readonly AccountType[] = [
  AccountType.JACKPOT_MINI,
  AccountType.JACKPOT_MINOR,
  AccountType.JACKPOT_MAJOR,
  AccountType.JACKPOT_GRAND,
];

/** The sixteen ledger movement types (FairPlay §3.2 + M1 Remediation agent types). */
export enum LedgerType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAW = 'WITHDRAW',
  RAKE = 'RAKE',
  BET = 'BET',
  WIN_PAYOUT = 'WIN_PAYOUT',
  INSURANCE_PREMIUM = 'INSURANCE_PREMIUM',
  INSURANCE_PAYOUT = 'INSURANCE_PAYOUT',
  REINSURANCE_INJECT = 'REINSURANCE_INJECT',
  REINSURANCE_PAYOUT = 'REINSURANCE_PAYOUT',
  JACKPOT_INJECT = 'JACKPOT_INJECT',
  JACKPOT_PAYOUT = 'JACKPOT_PAYOUT',
  LEAGUE_TOPUP = 'LEAGUE_TOPUP',
  LEAGUE_CASHOUT = 'LEAGUE_CASHOUT',
  /** A league putting its own inventory into a member's league wallet. */
  LEAGUE_GRANT = 'LEAGUE_GRANT',
  WITHDRAW_REFUND = 'WITHDRAW_REFUND',
  AGENT_COMMISSION = 'AGENT_COMMISSION',
  AGENT_VIP_BONUS = 'AGENT_VIP_BONUS',
}

export const LEDGER_TYPES: readonly LedgerType[] = Object.values(LedgerType);

/** Double-entry direction. Every fund movement produces a matched DEBIT + CREDIT pair. */
export enum LedgerDirection {
  /** Funds leaving an account (the source side of a transfer). */
  DEBIT = 'DEBIT',
  /** Funds entering an account (the destination side of a transfer). */
  CREDIT = 'CREDIT',
}

/** Lifecycle of a ledger entry. */
export enum LedgerStatus {
  PENDING = 'PENDING',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
  ROLLED_BACK = 'ROLLED_BACK',
}

/**
 * Wallet scope — distinguishes a player's Platform wallet from a League wallet (both are PLAYER
 * accounts per the spec). Platform-only for the Aug-30 MVP; the field exists now so adding leagues
 * later needs no migration. Format: 'PLATFORM' or `league:<leagueId>`.
 */
export const PLATFORM_SCOPE = 'PLATFORM';
