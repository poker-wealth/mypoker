import { AccountType } from '../domain/account-types';

/**
 * HD wallet derivation paths (BIP-44, FairPlay §3.4).
 *
 * One master key (in an HSM, never online, never in code) derives an independent on-chain address
 * for every pool. This module only computes the PATH strings — no keys, no signing. TRON coin type
 * is 195'. Account-level is 0' (the platform master account).
 *
 *   TREASURY hot/warm/cold  m/44'/195'/0'/0/{0|1|2}
 *   INSURANCE               m/44'/195'/0'/1/0
 *   REINSURANCE             m/44'/195'/0'/2/0
 *   LEAGUE_INVENTORY        m/44'/195'/0'/3/{leagueIndex}
 *   JACKPOT_*               m/44'/195'/0'/4/{tableIndex}/{tierIndex}
 *   PLAYER deposit address  m/44'/195'/0'/5/{playerIndex}
 */

const TRON_COIN_TYPE = "195'";
const BASE = `m/44'/${TRON_COIN_TYPE}/0'`;

export enum TreasuryTier {
  HOT = 0,
  WARM = 1,
  COLD = 2,
}

const JACKPOT_TIER_INDEX: Readonly<Record<string, number>> = {
  [AccountType.JACKPOT_MINI]: 0,
  [AccountType.JACKPOT_MINOR]: 1,
  [AccountType.JACKPOT_MAJOR]: 2,
  [AccountType.JACKPOT_GRAND]: 3,
};

export function treasuryPath(tier: TreasuryTier): string {
  return `${BASE}/0/${tier}`;
}

export function insurancePath(): string {
  return `${BASE}/1/0`;
}

export function reinsurancePath(): string {
  return `${BASE}/2/0`;
}

export function leagueInventoryPath(leagueIndex: number): string {
  assertIndex(leagueIndex, 'leagueIndex');
  return `${BASE}/3/${leagueIndex}`;
}

export function jackpotPath(jackpotType: AccountType, tableIndex: number): string {
  const tier = JACKPOT_TIER_INDEX[jackpotType];
  if (tier === undefined) {
    throw new Error(`jackpotPath: ${jackpotType} is not a jackpot account type`);
  }
  assertIndex(tableIndex, 'tableIndex');
  return `${BASE}/4/${tableIndex}/${tier}`;
}

export function playerDepositPath(playerIndex: number): string {
  assertIndex(playerIndex, 'playerIndex');
  return `${BASE}/5/${playerIndex}`;
}

function assertIndex(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}
