import { Money } from '../domain/money';
import { AccountType, LedgerType } from '../domain/account-types';
import { AccountModel } from '../wallet/account.model';
import { transfer } from '../wallet/transfer';
import { LeagueModel } from './league-store';
import {
  LeagueFundingModel,
  type LeagueFundingDoc,
  type LeagueFundingKind,
} from './league-funding.model';

/**
 * League top-up and cash-out (12-week plan, W10).
 *
 * Top-up:  "league admin initiates top-up request (TRC20 payment). Platform ops
 *          confirms TRC20 receipt. Platform ops executes transfer(TREASURY,
 *          LEAGUE_INVENTORY, amount, LEAGUE_TOPUP)… Large top-up (>threshold):
 *          requires second ops person confirmation."
 *
 * Cash-out: "league admin requests cash-out from League Inventory. Platform ops
 *          reviews. transfer(LEAGUE_INVENTORY, TREASURY, amount,
 *          LEAGUE_CASHOUT). TRC20 sent to league's registered address.
 *          Cooldown: 24 hours between cash-out requests."
 *
 * Both are a request, a review, and only then a transfer. The clearing rules
 * already whitelist TREASURY → LEAGUE_INVENTORY and back, and the ledger types
 * already existed; nothing performed either movement until this file.
 *
 * The direction matters for what can go wrong. A top-up credits a league with
 * platform money — the risk is paying out against a TRC-20 receipt that never
 * arrived, which is why ops confirms receipt before executing. A cash-out
 * drains a league's own inventory — the risk is emptying the pool that backs
 * its tables, which is why the balance is checked at execution rather than at
 * request, when it may have changed.
 */

export class LeagueFundingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeagueFundingError';
  }
}

/**
 * Above this, a top-up needs a second ops signature.
 *
 * THE SPEC DOES NOT GIVE A NUMBER. It says "large top-up (>threshold)" twice
 * and never defines the threshold. This reuses the withdrawal figure — §3.6's
 * "human review (> $10K)" — because it is the same mechanism guarding the same
 * kind of risk on the same platform, and a second invented number would be one
 * more thing to keep in step.
 *
 * Flagged rather than buried: if ops wants a different figure for leagues, this
 * is the line to change, and nothing else moves.
 */
export const LEAGUE_SECOND_APPROVAL_THRESHOLD = Money.fromDecimalString('10000');

/** "Cooldown: 24 hours between cash-out requests." */
export const CASHOUT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

async function leagueOrThrow(leagueId: string): Promise<void> {
  const league = await LeagueModel.findById(leagueId).lean();
  if (!league) throw new LeagueFundingError(`no such league: ${leagueId}`);
}

/**
 * A league admin asks for platform funds.
 *
 * Records intent only. No money moves here, and none should: the platform has
 * not yet confirmed the TRC-20 payment this is supposedly against.
 */
export async function requestTopUp(input: {
  leagueId: string;
  amount: Money;
  requestedBy: string;
}): Promise<string> {
  if (!input.amount.isPositive()) throw new LeagueFundingError('amount must be > 0');
  await leagueOrThrow(input.leagueId);

  const [doc] = await LeagueFundingModel.create([
    {
      leagueId: input.leagueId,
      kind: 'TOPUP' as LeagueFundingKind,
      amount: input.amount.toDecimal128(),
      state: 'REQUESTED',
      requestedBy: input.requestedBy,
    },
  ]);
  return doc!._id;
}

/**
 * A league admin asks to withdraw from their own inventory.
 *
 * The 24-hour cooldown is checked against the last REQUEST, not the last
 * execution. Counting from execution would let someone queue a dozen requests
 * in a minute and have the cooldown apply only to whichever ops happened to
 * approve first — the rule exists to slow the asking, not the approving.
 *
 * A rejected request still counts. Otherwise the cooldown is trivially defeated
 * by asking for something certain to be refused.
 */
export async function requestCashOut(input: {
  leagueId: string;
  amount: Money;
  requestedBy: string;
  address: string;
  now?: Date;
}): Promise<string> {
  if (!input.amount.isPositive()) throw new LeagueFundingError('amount must be > 0');
  if (!input.address) throw new LeagueFundingError('a payout address is required');
  await leagueOrThrow(input.leagueId);

  const now = input.now ?? new Date();
  const last = await LeagueFundingModel.findOne({
    leagueId: input.leagueId,
    kind: 'CASHOUT',
  })
    .sort({ createdAt: -1 })
    .lean();

  if (last) {
    const elapsed = now.getTime() - last.createdAt.getTime();
    if (elapsed < CASHOUT_COOLDOWN_MS) {
      const hours = Math.ceil((CASHOUT_COOLDOWN_MS - elapsed) / 3_600_000);
      throw new LeagueFundingError(`cash-out cooldown: try again in ${hours}h`);
    }
  }

  const [doc] = await LeagueFundingModel.create([
    {
      leagueId: input.leagueId,
      kind: 'CASHOUT' as LeagueFundingKind,
      amount: input.amount.toDecimal128(),
      state: 'REQUESTED',
      requestedBy: input.requestedBy,
      address: input.address,
    },
  ]);
  return doc!._id;
}

export interface FundingApproval {
  applied: boolean;
  approvals: string[];
  awaitingSecondApproval?: true;
}

/**
 * Ops signs off. Still moves no money — that is `executeLeagueFunding`.
 *
 * Approving and executing are separate on purpose. The spec has ops confirming
 * a TRC-20 receipt before a top-up executes, and that confirmation is a
 * judgment about the outside world which may be made minutes before the ledger
 * is touched. Collapsing them would mean the moment someone said "yes, the
 * money arrived" the transfer fired, with no room to notice they were wrong.
 *
 * Approvals are a SET of names via $addToSet — the same reasoning as
 * withdrawals. "A second person" cannot be satisfied by one person twice, and
 * a counter cannot tell the difference.
 */
export async function approveLeagueFunding(
  requestId: string,
  approvedBy: string,
): Promise<FundingApproval> {
  if (!approvedBy) throw new LeagueFundingError('an approver is required');

  const recorded = await LeagueFundingModel.findOneAndUpdate(
    { _id: requestId, state: 'REQUESTED' },
    { $addToSet: { approvals: approvedBy } },
    { new: true },
  );
  if (!recorded) throw new LeagueFundingError('request is not awaiting approval');

  const approvals = recorded.approvals ?? [];
  // Only top-ups carry the threshold. A cash-out moves a league's OWN money
  // back out; the spec asks for review, not for two signatures.
  const needsSecond =
    recorded.kind === 'TOPUP' &&
    Money.fromDecimal128(recorded.amount).greaterThan(LEAGUE_SECOND_APPROVAL_THRESHOLD);

  if (needsSecond && approvals.length < 2) {
    return { applied: false, approvals, awaitingSecondApproval: true };
  }

  await LeagueFundingModel.updateOne({ _id: requestId }, { $set: { state: 'APPROVED' } });
  return { applied: true, approvals };
}

export async function rejectLeagueFunding(
  requestId: string,
  rejectedBy: string,
  reason: string,
): Promise<void> {
  const moved = await LeagueFundingModel.updateOne(
    // Rejectable while requested OR approved: someone who signed off and then
    // learned the TRC-20 never arrived must be able to stop it.
    { _id: requestId, state: { $in: ['REQUESTED', 'APPROVED'] } },
    { $set: { state: 'REJECTED', rejectedBy, rejectionReason: reason } },
  );
  if (moved.matchedCount === 0) throw new LeagueFundingError('request cannot be rejected');
}

/** The league's own inventory account, created on demand. */
export const leagueInventoryId = (leagueId: string): string => `linv:${leagueId}`;

async function ensureInventory(leagueId: string): Promise<string> {
  const _id = leagueInventoryId(leagueId);
  await AccountModel.updateOne(
    { _id },
    { $setOnInsert: { _id, accountType: AccountType.LEAGUE_INVENTORY, ownerId: leagueId } },
    { upsert: true },
  );
  return _id;
}

/**
 * Move the money. The only function here that touches a balance.
 *
 * Idempotent on the request id, so a retried execution cannot fund a league
 * twice. The transfer itself enforces the clearing rules and refuses an
 * overdraft, which is what stops a cash-out draining an inventory that has
 * already been spent since the request was made.
 */
export async function executeLeagueFunding(
  requestId: string,
  treasuryAccountId: string,
): Promise<{ applied: boolean }> {
  const req = await LeagueFundingModel.findById(requestId).lean();
  if (!req) throw new LeagueFundingError(`no such request: ${requestId}`);
  if (req.state !== 'APPROVED') {
    throw new LeagueFundingError(`request is ${req.state}, not APPROVED`);
  }

  const inventory = await ensureInventory(req.leagueId);
  const amount = Money.fromDecimal128(req.amount);

  const [from, to, type] =
    req.kind === 'TOPUP'
      ? ([treasuryAccountId, inventory, LedgerType.LEAGUE_TOPUP] as const)
      : ([inventory, treasuryAccountId, LedgerType.LEAGUE_CASHOUT] as const);

  const result = await transfer({
    fromAccountId: from,
    toAccountId: to,
    amount,
    type,
    businessId: requestId,
    // The request id, so a replayed execution is a no-op rather than a second
    // movement — the same guard every other money path here uses.
    idempotencyKey: `league:${req.kind.toLowerCase()}:${requestId}`,
    metadata: { leagueId: req.leagueId, ...(req.address ? { address: req.address } : {}) },
  });

  await LeagueFundingModel.updateOne({ _id: requestId }, { $set: { state: 'EXECUTED' } });
  return { applied: result.applied ?? true };
}

/** Outstanding requests, for the admin review queue. */
export async function pendingLeagueFunding(): Promise<LeagueFundingDoc[]> {
  return LeagueFundingModel.find({ state: { $in: ['REQUESTED', 'APPROVED'] } })
    .sort({ createdAt: 1 })
    .lean();
}
