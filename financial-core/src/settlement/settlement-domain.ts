import { AccountType } from '../domain/account-types';

/**
 * Settlement Domain — the rake-routing rules hub (FairPlay §3.10).
 *
 * The single place that decides where rake goes. Platform tables → TREASURY. League tables →
 * that league's LEAGUE_INVENTORY. Zero cross-system sharing, zero double-rake. New games change
 * NOTHING here — they just declare their table type.
 */

export enum TableType {
  PLATFORM = 'PLATFORM',
  LEAGUE = 'LEAGUE',
}

export interface AccountTarget {
  accountType: AccountType;
  ownerId: string;
}

export function getRakeDestination(tableType: TableType, leagueId?: string): AccountTarget {
  if (tableType === TableType.PLATFORM) {
    return { accountType: AccountType.TREASURY, ownerId: 'PLATFORM' };
  }
  if (!leagueId) {
    throw new Error('getRakeDestination: leagueId is required for LEAGUE tables');
  }
  return { accountType: AccountType.LEAGUE_INVENTORY, ownerId: leagueId };
}
