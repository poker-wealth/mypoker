import type { ClientSession } from 'mongoose';
import { Money } from '../domain/money';
import { LedgerType } from '../domain/account-types';
import { AccountModel } from '../wallet/account.model';
import { transferInSession, runTransaction } from '../wallet/transfer';
import { getRakeDestination, TableType } from './settlement-domain';
import { buildSettlementReceipt, type SettlementReceipt } from './settlement-receipt';
import { SettlementModel } from './settlement.model';

/**
 * Settlement Engine — Phase 1 (FairPlay §3.5). Strong-consistency, all-or-nothing, one local
 * transaction. Applies the house cuts to a finished hand in spec order — jackpot inject → rake —
 * and emits a settlement_receipt.
 *
 * Model: the gross pot has already been awarded to the winner by the game layer's bet/pot
 * transfers, so the winner holds their winnings entering settlement. settleRound then deducts the
 * jackpot (0.5% of winner profit, NEVER charged to losers) and the rake. Multi-winner / side-pot
 * distribution arrives with Texas Hold'em in M3.
 *
 * Idempotent per round: the settlements collection's unique roundId makes a replay a no-op.
 */

export interface JackpotAccounts {
  mini: string;
  minor: string;
  major: string;
  grand: string;
}

export interface SettleRoundInput {
  roundId: string;
  tableType: TableType;
  leagueId?: string;
  /** The winner who holds the gross pot; pays jackpot + rake out of their winnings. */
  winnerAccountId: string;
  /** winner_chips_won − winner_chips_invested. Basis for the 0.5% jackpot injection. */
  winnerProfit: Money;
  /** Rake amount (game server computes from the table's rake %). */
  rake: Money;
  /** The table's four jackpot pool account IDs (created at table creation). */
  jackpotAccounts: JackpotAccounts;
}

const JACKPOT_RATE_BP = 50n; // 0.5%
const MINI_BP = 2000n; // 20%
const MINOR_BP = 3000n; // 30%
const MAJOR_BP = 2500n; // 25%
// Grand (25%) takes the remainder so the four shares sum EXACTLY to the total — no lost micro-units.

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export async function settleRound(input: SettleRoundInput): Promise<SettlementReceipt> {
  // Round-level idempotency (fast path).
  const already = await SettlementModel.findOne({ roundId: input.roundId });
  if (already) return already.receipt;

  // Jackpot split: 0.5% of winner profit, apportioned 20/30/25/25 with the remainder to Grand
  // so the parts reconcile to the total exactly.
  const jackpotTotal = input.winnerProfit.mulBasisPoints(JACKPOT_RATE_BP);
  const mini = jackpotTotal.mulBasisPoints(MINI_BP);
  const minor = jackpotTotal.mulBasisPoints(MINOR_BP);
  const major = jackpotTotal.mulBasisPoints(MAJOR_BP);
  const grand = jackpotTotal.subtract(mini).subtract(minor).subtract(major);

  // Resolve rake destination account (TREASURY for platform, LEAGUE_INVENTORY for league).
  const dest = getRakeDestination(input.tableType, input.leagueId);
  const rakeAccount = await AccountModel.findOne({
    accountType: dest.accountType,
    ownerId: dest.ownerId,
  });
  if (!rakeAccount) {
    throw new Error(`Rake destination account not found: ${dest.accountType}/${dest.ownerId}`);
  }

  const receipt = buildSettlementReceipt({
    roundId: input.roundId,
    jackpotTotal,
    rake: input.rake,
    payout: input.winnerProfit,
    accounts: {
      jackpotMini: input.jackpotAccounts.mini,
      jackpotMinor: input.jackpotAccounts.minor,
      jackpotMajor: input.jackpotAccounts.major,
      jackpotGrand: input.jackpotAccounts.grand,
      rakeDest: rakeAccount._id,
      winner: input.winnerAccountId,
    },
  });

  const injects: Array<{ account: string; amount: Money; tier: string }> = [
    { account: input.jackpotAccounts.mini, amount: mini, tier: 'mini' },
    { account: input.jackpotAccounts.minor, amount: minor, tier: 'minor' },
    { account: input.jackpotAccounts.major, amount: major, tier: 'major' },
    { account: input.jackpotAccounts.grand, amount: grand, tier: 'grand' },
  ];

  try {
    await runTransaction(async (session: ClientSession) => {
      // Re-check inside the transaction (guards a concurrent settle of the same round).
      const dup = await SettlementModel.findOne({ roundId: input.roundId }).session(session);
      if (dup) return;

      // Step 1 — jackpot injection (winner → 4 pools), in tier order. Zero shares are skipped.
      for (const inj of injects) {
        if (inj.amount.isPositive()) {
          await transferInSession(
            {
              fromAccountId: input.winnerAccountId,
              toAccountId: inj.account,
              amount: inj.amount,
              type: LedgerType.JACKPOT_INJECT,
              idempotencyKey: `${input.roundId}:jackpot:${inj.tier}`,
              businessId: input.roundId,
            },
            session,
          );
        }
      }

      // Step 2 — rake (winner → TREASURY or LEAGUE_INVENTORY).
      if (input.rake.isPositive()) {
        await transferInSession(
          {
            fromAccountId: input.winnerAccountId,
            toAccountId: rakeAccount._id,
            amount: input.rake,
            type: LedgerType.RAKE,
            idempotencyKey: `${input.roundId}:rake`,
            businessId: input.roundId,
          },
          session,
        );
      }

      // Persist the receipt — unique roundId commits the round exactly once.
      await SettlementModel.create([{ roundId: input.roundId, receipt }], { session });
    });
  } catch (err) {
    // Lost a concurrent race to settle this round — return the winner's persisted receipt.
    if (isDuplicateKeyError(err)) {
      const winner = await SettlementModel.findOne({ roundId: input.roundId });
      if (winner) return winner.receipt;
    }
    throw err;
  }

  return receipt;
}
