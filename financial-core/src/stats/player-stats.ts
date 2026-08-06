import { Decimal128 } from 'bson';
import type { PipelineStage } from 'mongoose';
import { Money } from '../domain/money';
import { LedgerType, LedgerDirection } from '../domain/account-types';
import { LedgerModel } from '../wallet/ledger.model';
import { getOrCreatePlayerAccount } from '../wallet/system-accounts';

/**
 * Player statistics, derived from the ledger.
 *
 * There is no hand-history collection anywhere in the platform — the ledger is
 * the only per-player record that exists. That bounds what can honestly be
 * reported here:
 *
 *   derivable  — hands played, hands won, win rate, biggest win, net profit
 *   NOT derivable — VPIP, PFR, largest pot
 *
 * VPIP and PFR need preflop *action* data (did the player voluntarily put money
 * in; did they raise), and the ledger records only the net movement for a round.
 * Largest pot needs the whole round's volume, not this player's share. Those
 * three require the game server to persist hand records, which it does not do.
 * They are deliberately absent from this module rather than approximated —
 * a plausible-looking wrong number is worse than an honest gap.
 *
 * A "hand" is a round in which the player placed a BET. Deposits and withdrawals
 * are excluded from profit throughout: moving your own money in and out is not
 * winning or losing it, and counting it would make every deposit look like a win.
 */

/** Ledger types that represent playing, as opposed to funding the account. */
const GAME_TYPES: LedgerType[] = [
  LedgerType.BET,
  LedgerType.WIN_PAYOUT,
  LedgerType.RAKE,
  LedgerType.JACKPOT_PAYOUT,
  LedgerType.INSURANCE_PREMIUM,
  LedgerType.INSURANCE_PAYOUT,
];

export interface PlayerStats {
  handsPlayed: number;
  handsWon: number;
  /** Percentage, one decimal place, e.g. '52.3'. Null when no hands played. */
  winRate: string | null;
  /** Decimal string. */
  biggestWin: string;
  /** Decimal string; negative if the player is down. */
  netProfit: string;
  /**
   * Total staked, as a decimal string.
   *
   * RAW volume — every bet counted at face value. This is deliberately NOT the
   * "effective volume" the VIP ladder is graded on: that applies a coefficient
   * per game (Baccarat ×0.3 and so on), and the ledger does not record which
   * game a round belonged to — settlement writes no metadata.
   *
   * So do not derive a VIP tier from this. For a Baccarat-heavy player it
   * overstates effective volume by more than 3×, which would promise privileges
   * — withdrawal priority, instant transfer — that were never earned. VIP needs
   * either a gameId on ledger entries or its own persisted state.
   */
  cumulativeVolumeRaw: string;
}

export interface HistoryEntry {
  roundId: string;
  /** Decimal string, signed: what the player netted on this round. */
  net: string;
  won: boolean;
  at: string;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  /** Pass back as `cursor` for the next page. Null when there are no more. */
  nextCursor: string | null;
}

interface RoundRow {
  _id: string;
  credit: Decimal128;
  debit: Decimal128;
  /** BET debits only — the stake, not rake or premiums. */
  staked: Decimal128;
  won: boolean;
  at: Date;
}

/**
 * Collapse a player's game-related ledger entries into one row per round.
 *
 * Grouping in Mongo rather than in JS keeps the result bounded by rounds played
 * rather than by ledger entries, which is several per round.
 */
async function roundsFor(
  accountId: string,
  options: { before?: Date; since?: Date; limit?: number } = {},
): Promise<RoundRow[]> {
  const match: Record<string, unknown> = {
    accountId,
    type: { $in: GAME_TYPES },
    businessId: { $ne: null },
  };
  // `before` paginates, `since` bounds the reporting period. Both can apply at
  // once — page 3 of "last 7 days" needs each.
  const createdAt: Record<string, Date> = {};
  if (options.before) createdAt.$lt = options.before;
  if (options.since) createdAt.$gte = options.since;
  if (Object.keys(createdAt).length > 0) match.createdAt = createdAt;

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $group: {
        _id: '$businessId',
        credit: {
          $sum: { $cond: [{ $eq: ['$direction', LedgerDirection.CREDIT] }, '$amount', Decimal128.fromString('0')] },
        },
        debit: {
          $sum: { $cond: [{ $eq: ['$direction', LedgerDirection.DEBIT] }, '$amount', Decimal128.fromString('0')] },
        },
        staked: {
          $sum: { $cond: [{ $eq: ['$type', LedgerType.BET] }, '$amount', Decimal128.fromString('0')] },
        },
        won: { $max: { $cond: [{ $eq: ['$type', LedgerType.WIN_PAYOUT] }, true, false] } },
        at: { $max: '$createdAt' },
      },
    },
    { $sort: { at: -1 } },
  ];
  if (options.limit) pipeline.push({ $limit: options.limit });

  return LedgerModel.aggregate<RoundRow>(pipeline);
}

/** Reporting windows the Data tab offers. */
export type StatsPeriod = 'today' | '7d' | '30d' | 'all';

export const STATS_PERIODS: StatsPeriod[] = ['today', '7d', '30d', 'all'];

/**
 * Start of a reporting window, or undefined for all time.
 *
 * "Today" is UTC, not the player's local midnight — the server has no reliable
 * timezone for them, and a boundary that shifts per request is worse than one
 * that is consistently explainable. Revisit if players start reporting that
 * their day rolls over at the wrong time.
 */
export function periodStart(period: StatsPeriod, now: Date = new Date()): Date | undefined {
  const DAY_MS = 86_400_000;
  switch (period) {
    case 'today': {
      const start = new Date(now);
      start.setUTCHours(0, 0, 0, 0);
      return start;
    }
    case '7d':
      return new Date(now.getTime() - 7 * DAY_MS);
    case '30d':
      return new Date(now.getTime() - 30 * DAY_MS);
    case 'all':
      return undefined;
  }
}

export async function getPlayerStats(
  playerId: string,
  options: { period?: StatsPeriod; now?: Date } = {},
): Promise<PlayerStats> {
  const account = await getOrCreatePlayerAccount(playerId);
  // Clock is injected rather than mocked: jest's fake timers freeze the ones
  // Mongo's driver depends on, and the query never returns.
  const since = periodStart(options.period ?? 'all', options.now ?? new Date());
  const rounds = await roundsFor(account._id, since ? { since } : {});

  let netProfit = Money.ZERO;
  let biggestWin = Money.ZERO;
  let volume = Money.ZERO;
  let handsWon = 0;

  for (const round of rounds) {
    // Money is bigint micros — the arithmetic never touches a float (iron rule 7).
    const net = Money.fromDecimal128(round.credit).subtract(Money.fromDecimal128(round.debit));
    netProfit = netProfit.add(net);
    volume = volume.add(Money.fromDecimal128(round.staked));
    if (round.won) {
      handsWon += 1;
      if (net.greaterThan(biggestWin)) biggestWin = net;
    }
  }

  const handsPlayed = rounds.length;

  return {
    handsPlayed,
    handsWon,
    winRate: handsPlayed === 0 ? null : ((handsWon / handsPlayed) * 100).toFixed(1),
    biggestWin: biggestWin.toString(),
    netProfit: netProfit.toString(),
    cumulativeVolumeRaw: volume.toString(),
  };
}

export async function getPlayerHistory(
  playerId: string,
  options: { limit?: number; cursor?: string; period?: StatsPeriod; now?: Date } = {},
): Promise<HistoryPage> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const account = await getOrCreatePlayerAccount(playerId);

  const before = options.cursor ? new Date(options.cursor) : undefined;
  if (before && Number.isNaN(before.getTime())) {
    throw new RangeError('cursor must be an ISO timestamp');
  }
  const since = periodStart(options.period ?? 'all', options.now ?? new Date());

  // Fetch one extra to learn whether another page exists, without a count query.
  const rows = await roundsFor(account._id, {
    ...(before ? { before } : {}),
    ...(since ? { since } : {}),
    limit: limit + 1,
  });

  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;

  return {
    entries: page.map((round) => ({
      roundId: round._id,
      net: Money.fromDecimal128(round.credit).subtract(Money.fromDecimal128(round.debit)).toString(),
      won: round.won,
      at: round.at.toISOString(),
    })),
    nextCursor: hasMore && page.length > 0 ? page[page.length - 1]!.at.toISOString() : null,
  };
}
