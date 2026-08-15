import { Money } from '../domain/money';
import { AccountType } from '../domain/account-types';
import { AccountModel } from '../wallet/account.model';
import { getReputationFacts } from '../reputation/player-reputation';
import { getVolumeFacts } from '../vip/volume-tracker';
import type { FindingReason } from '../reputation/player-reputation';

/**
 * One player's account, for the admin Players screen (SAMUEL.md task 3,
 * screen 3; 12-week plan W10 "player search… show full account detail").
 *
 * READ ONLY, and structurally so. There is no counterpart that writes: the doc
 * says "no balance editing from the UI — ever", and the way to hold a rule like
 * that is to have no function that could. An admin who needs to move a player's
 * money uses the withdrawal and settlement paths, which are audited, idempotent
 * and double-entry. A direct balance edit is none of those.
 *
 * Reputation comes back as FACTS — rounds played and confirmed findings — not
 * as a score. The scoring rules live in the gateway with the rest of them, and
 * a second copy here would drift from the number the player sees on their own
 * profile. An admin and a player disagreeing about a reputation score is worse
 * than either of them lacking it.
 */
export interface AdminPlayerDetail {
  playerId: string;
  /**
   * False when no account exists yet. financial-core creates accounts lazily on
   * first money movement, so a registered player who has never deposited has no
   * row — and that is a real state worth showing rather than a zero balance
   * that implies they had funds and spent them.
   */
  hasAccount: boolean;
  balances: {
    available: string;
    locked: string;
    clearing: string;
    total: string;
  };
  reputation: { roundsPlayed: number; findings: FindingReason[] };
  volume: { cumulativeEffective: number; monthlyEffective: number };
}

const ZERO = '0.000000';

export async function getAdminPlayerDetail(playerId: string): Promise<AdminPlayerDetail> {
  // findOne, never getOrCreatePlayerAccount: an admin looking someone up must
  // not bring an account into existence as a side effect of reading.
  const account = await AccountModel.findOne({
    accountType: AccountType.PLAYER,
    ownerId: playerId,
  }).lean();

  const [reputation, volume] = await Promise.all([
    getReputationFacts(playerId),
    getVolumeFacts(playerId),
  ]);

  if (!account) {
    return {
      playerId,
      hasAccount: false,
      balances: { available: ZERO, locked: ZERO, clearing: ZERO, total: ZERO },
      reputation: { roundsPlayed: reputation.roundsPlayed, findings: reputation.findings },
      volume: {
        cumulativeEffective: volume.cumulativeEffective,
        monthlyEffective: volume.monthlyEffective,
      },
    };
  }

  const available = Money.fromDecimal128(account.availableBalance);
  const locked = Money.fromDecimal128(account.lockedBalance);
  const clearing = Money.fromDecimal128(account.clearingBalance);

  return {
    playerId,
    hasAccount: true,
    balances: {
      available: available.toString(),
      locked: locked.toString(),
      clearing: clearing.toString(),
      // Summed here, so the client never adds decimal strings as floats.
      total: available.add(locked).add(clearing).toString(),
    },
    reputation: { roundsPlayed: reputation.roundsPlayed, findings: reputation.findings },
    volume: {
      cumulativeEffective: volume.cumulativeEffective,
      monthlyEffective: volume.monthlyEffective,
    },
  };
}

/** Balances for many players at once, for the search results list. */
export async function getPlayerBalances(
  playerIds: readonly string[],
): Promise<Map<string, string>> {
  if (playerIds.length === 0) return new Map();

  const accounts = await AccountModel.find(
    { accountType: AccountType.PLAYER, ownerId: { $in: [...playerIds] } },
    { ownerId: 1, availableBalance: 1, lockedBalance: 1, clearingBalance: 1 },
  ).lean();

  return new Map(
    accounts.map((a) => [
      a.ownerId,
      Money.fromDecimal128(a.availableBalance)
        .add(Money.fromDecimal128(a.lockedBalance))
        .add(Money.fromDecimal128(a.clearingBalance))
        .toString(),
    ]),
  );
}
