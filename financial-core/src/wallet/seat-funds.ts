import { Money } from '../domain/money';
import { AccountType } from '../domain/account-types';
import { AccountModel } from './account.model';
import { AccountNotFoundError, InsufficientBalanceError } from './errors';

/**
 * Seat funds — table buy-in / leave-table fund locking (FairPlay §3; M1 frozen_amount lifecycle).
 *
 * A buy-in moves funds available → locked. Locked funds are the player's escrowed table stack:
 * NOT spendable elsewhere and NOT withdrawable (the withdrawal machine only ever touches
 * available). Leaving the table releases the remaining stack locked → available.
 *
 * Both operations are single-document atomic updates with a balance guard — overdraft and
 * over-release are impossible, and the optimistic `version` advances on every change. No ledger
 * entry: this is an intra-account reclassification, audited by the table/seat state and `version`,
 * not an inter-account fund movement.
 */

async function explainNoMatch(playerAccountId: string): Promise<never> {
  const acc = await AccountModel.findById(playerAccountId);
  if (!acc) throw new AccountNotFoundError(playerAccountId);
  if (acc.accountType !== AccountType.PLAYER) {
    throw new Error(`seat funds: ${playerAccountId} is not a PLAYER account`);
  }
  throw new InsufficientBalanceError(playerAccountId);
}

/** Buy-in: lock `amount` from available into the player's table stack. */
export async function lockForBuyIn(playerAccountId: string, amount: Money): Promise<void> {
  if (!amount.isPositive()) throw new RangeError('buy-in amount must be > 0');
  const amountD = amount.toDecimal128();
  const negAmountD = amount.negate().toDecimal128();

  const res = await AccountModel.updateOne(
    {
      _id: playerAccountId,
      accountType: AccountType.PLAYER,
      availableBalance: { $gte: amountD },
    },
    { $inc: { availableBalance: negAmountD, lockedBalance: amountD, version: 1 } },
  );
  if (res.matchedCount === 0) await explainNoMatch(playerAccountId);
}

/** Leave table / cash out: release `amount` from the locked stack back to available. */
export async function releaseToAvailable(playerAccountId: string, amount: Money): Promise<void> {
  if (!amount.isPositive()) throw new RangeError('release amount must be > 0');
  const amountD = amount.toDecimal128();
  const negAmountD = amount.negate().toDecimal128();

  const res = await AccountModel.updateOne(
    {
      _id: playerAccountId,
      accountType: AccountType.PLAYER,
      lockedBalance: { $gte: amountD },
    },
    { $inc: { lockedBalance: negAmountD, availableBalance: amountD, version: 1 } },
  );
  if (res.matchedCount === 0) await explainNoMatch(playerAccountId);
}
