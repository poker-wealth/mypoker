import { createHash } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { Money } from '../domain/money';
import { LedgerType, LedgerDirection, LedgerStatus } from '../domain/account-types';
import { AccountModel } from '../wallet/account.model';
import { LedgerModel } from '../wallet/ledger.model';
import { runTransaction } from '../wallet/transfer';
import { AccountNotFoundError, InsufficientBalanceError } from '../wallet/errors';
import { getRakeDestination, TableType } from './settlement-domain';
import { SettlementModel } from './settlement.model';

/**
 * Multi-party table-hand settlement (Settlement Engine, table version). Operates on players'
 * LOCKED balances (their table stakes): losers' locked drops, winners' rises; the rake is credited
 * to the house (TREASURY / LEAGUE_INVENTORY) and the jackpot to the four pools.
 *
 * One transaction, idempotent per round, and refuses to apply unless the books balance:
 *   Σ(loser losses) = Σ(winner gains) + rake + Σ(jackpot).
 *
 * This is a privileged engine operation (like the withdrawal machine) — it adjusts balances
 * directly with that conservation invariant as its integrity check, and records the pooled flow in
 * the double-entry ledger (loser BET debits; winner WIN_PAYOUT, rake RAKE, jackpot JACKPOT_INJECT
 * credits) so Σ(debits) = Σ(credits).
 */

export interface SettlementParty {
  accountId: string;
  amount: Money;
}

export interface JackpotShares {
  mini: Money;
  minor: Money;
  major: Money;
  grand: Money;
}

export interface TableSettlementInput {
  roundId: string;
  tableType: TableType;
  leagueId?: string;
  losers: SettlementParty[];
  winners: SettlementParty[];
  rake: Money;
  jackpot: JackpotShares;
  jackpotAccounts: { mini: string; minor: string; major: string; grand: string };
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export async function settleTableHand(
  input: TableSettlementInput,
): Promise<{ roundId: string; applied: boolean }> {
  const already = await SettlementModel.findOne({ roundId: input.roundId });
  if (already) return { roundId: input.roundId, applied: false };

  // Conservation: losses must exactly fund wins + rake + jackpot.
  const totalLoss = Money.sum(input.losers.map((l) => l.amount));
  const jackpotTotal = Money.sum([
    input.jackpot.mini,
    input.jackpot.minor,
    input.jackpot.major,
    input.jackpot.grand,
  ]);
  const credits = Money.sum(input.winners.map((w) => w.amount)).add(input.rake).add(jackpotTotal);
  if (!totalLoss.equals(credits)) {
    throw new Error('table settlement is not conserved (Σ losers ≠ Σ winners + rake + jackpot)');
  }

  // Resolve the rake destination (platform → TREASURY, league → LEAGUE_INVENTORY).
  const dest = getRakeDestination(input.tableType, input.leagueId);
  const rakeAccount = await AccountModel.findOne({
    accountType: dest.accountType,
    ownerId: dest.ownerId,
  });
  if (input.rake.isPositive() && !rakeAccount) {
    throw new AccountNotFoundError(`${dest.accountType}/${dest.ownerId}`);
  }

  const receipt = {
    type: 'table',
    roundId: input.roundId,
    rake: input.rake.toString(),
    jackpotTotal: jackpotTotal.toString(),
    losers: input.losers.map((l) => ({ accountId: l.accountId, amount: l.amount.toString() })),
    winners: input.winners.map((w) => ({ accountId: w.accountId, amount: w.amount.toString() })),
    hash: '',
  };
  receipt.hash = createHash('sha256').update(JSON.stringify(receipt)).digest('hex');

  const pot = `pot:${input.roundId}`;
  const jpRows: { account: string; amount: Money; tier: string }[] = [
    { account: input.jackpotAccounts.mini, amount: input.jackpot.mini, tier: 'mini' },
    { account: input.jackpotAccounts.minor, amount: input.jackpot.minor, tier: 'minor' },
    { account: input.jackpotAccounts.major, amount: input.jackpot.major, tier: 'major' },
    { account: input.jackpotAccounts.grand, amount: input.jackpot.grand, tier: 'grand' },
  ];

  try {
    await runTransaction(async (session: ClientSession) => {
      const dup = await SettlementModel.findOne({ roundId: input.roundId }).session(session);
      if (dup) return;

      // Debit each loser from LOCKED (guard prevents losing more than is staked).
      for (const l of input.losers) {
        const res = await AccountModel.updateOne(
          { _id: l.accountId, lockedBalance: { $gte: l.amount.toDecimal128() } },
          { $inc: { lockedBalance: l.amount.negate().toDecimal128(), version: 1 } },
          { session },
        );
        if (res.matchedCount === 0) throw new InsufficientBalanceError(l.accountId);
      }
      // Credit each winner to LOCKED (their table stack grows).
      for (const w of input.winners) {
        await AccountModel.updateOne(
          { _id: w.accountId },
          { $inc: { lockedBalance: w.amount.toDecimal128(), version: 1 } },
          { session },
        );
      }
      // Rake to the house (spendable income).
      if (input.rake.isPositive()) {
        await AccountModel.updateOne(
          { _id: rakeAccount!._id },
          { $inc: { availableBalance: input.rake.toDecimal128(), version: 1 } },
          { session },
        );
      }
      // Jackpot to the pools.
      for (const j of jpRows) {
        if (j.amount.isPositive()) {
          await AccountModel.updateOne(
            { _id: j.account },
            { $inc: { availableBalance: j.amount.toDecimal128(), version: 1 } },
            { session },
          );
        }
      }

      // Double-entry ledger for the pooled flow.
      const rows = [
        ...input.losers.map((l) => ({
          idempotencyKey: `${input.roundId}:loss:${l.accountId}`,
          businessId: input.roundId,
          accountId: l.accountId,
          counterpartyAccountId: pot,
          direction: LedgerDirection.DEBIT,
          amount: l.amount.toDecimal128(),
          type: LedgerType.BET,
          status: LedgerStatus.SETTLED,
        })),
        ...input.winners.map((w) => ({
          idempotencyKey: `${input.roundId}:win:${w.accountId}`,
          businessId: input.roundId,
          accountId: w.accountId,
          counterpartyAccountId: pot,
          direction: LedgerDirection.CREDIT,
          amount: w.amount.toDecimal128(),
          type: LedgerType.WIN_PAYOUT,
          status: LedgerStatus.SETTLED,
        })),
      ];
      if (input.rake.isPositive()) {
        rows.push({
          idempotencyKey: `${input.roundId}:rake`,
          businessId: input.roundId,
          accountId: rakeAccount!._id,
          counterpartyAccountId: pot,
          direction: LedgerDirection.CREDIT,
          amount: input.rake.toDecimal128(),
          type: LedgerType.RAKE,
          status: LedgerStatus.SETTLED,
        });
      }
      for (const j of jpRows) {
        if (j.amount.isPositive()) {
          rows.push({
            idempotencyKey: `${input.roundId}:jp:${j.tier}`,
            businessId: input.roundId,
            accountId: j.account,
            counterpartyAccountId: pot,
            direction: LedgerDirection.CREDIT,
            amount: j.amount.toDecimal128(),
            type: LedgerType.JACKPOT_INJECT,
            status: LedgerStatus.SETTLED,
          });
        }
      }
      await LedgerModel.create(rows, { session, ordered: true });
      await SettlementModel.create([{ roundId: input.roundId, receipt }], { session });
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) return { roundId: input.roundId, applied: false };
    throw err;
  }

  return { roundId: input.roundId, applied: true };
}
