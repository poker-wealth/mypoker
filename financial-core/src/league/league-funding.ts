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
 * Above this, a funding movement — top-up OR cash-out — needs a second ops
 * signature (W10: "league top-up and cash-out workflow with second-person
 * confirmation"; §11.2: "All admin actions require second ops person approval").
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
  // BOTH kinds carry the threshold. The W10 deliverables line is explicit that
  // the workflow — "league top-up and cash-out workflow with second-person
  // confirmation" — covers both directions, and §11.2's Operations Staff row
  // backs it up: "All admin actions require second ops person approval." A
  // cash-out is a league's own money, but it leaves the platform for a TRC-20
  // address someone typed; that is exactly the operation a second pair of eyes
  // exists for.
  const needsSecond = Money.fromDecimal128(recorded.amount).greaterThan(
    LEAGUE_SECOND_APPROVAL_THRESHOLD,
  );

  if (needsSecond && approvals.length < 2) {
    return { applied: false, approvals, awaitingSecondApproval: true };
  }

  // CAS, not a blind $set: only a request still REQUESTED may become APPROVED.
  // Without the filter, an approval racing a rejection would flip the doc from
  // REJECTED back to APPROVED — and the next /execute would move money that an
  // ops person explicitly stopped. (The withdrawal path this file mirrors has
  // always had this guard; its absence here was the gap.)
  const promoted = await LeagueFundingModel.updateOne(
    { _id: requestId, state: 'REQUESTED' },
    { $set: { state: 'APPROVED' } },
  );
  if (promoted.matchedCount === 0) {
    // Somebody else moved the state after our signature landed. A concurrent
    // approver reaching APPROVED first is the same outcome we wanted; anything
    // else (rejected, executing) means this approval must not stand as applied.
    const current = await LeagueFundingModel.findById(requestId).lean();
    if (current?.state !== 'APPROVED') {
      throw new LeagueFundingError(
        `request is ${current?.state ?? 'gone'}, not approvable`,
      );
    }
  }
  return { applied: true, approvals };
}

export async function rejectLeagueFunding(
  requestId: string,
  rejectedBy: string,
  reason: string,
): Promise<void> {
  const moved = await LeagueFundingModel.updateOne(
    // Rejectable while requested OR approved: someone who signed off and then
    // learned the TRC-20 never arrived must be able to stop it. NOT while
    // EXECUTING — past the claim the transfer may already be in the ledger,
    // and a rejection that pretends to have stopped it would be a lie in the
    // audit trail. Too late is an answer, and this returns it.
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
 *
 * Three steps, and the ORDER is the safety:
 *
 *   1. CLAIM — one atomic CAS takes APPROVED → EXECUTING. From that moment a
 *      reject can no longer land (it targets REQUESTED/APPROVED only), so the
 *      old race — reject slipping in between "state is APPROVED" and the
 *      transfer, then being buried under EXECUTED — cannot happen.
 *   2. TRANSFER — idempotent on the request id.
 *   3. MARK — EXECUTING → EXECUTED.
 *
 * The claim also accepts a request already EXECUTING: that is a retry resuming
 * after a crash between steps 2 and 3, and the idempotency key makes the
 * replayed transfer a no-op. A transfer that FAILS hands the claim back
 * (EXECUTING → APPROVED) so the request is not stranded; if even that write is
 * lost, EXECUTING remains resumable rather than stuck.
 */
export async function executeLeagueFunding(
  requestId: string,
  treasuryAccountId: string,
  executedBy: string,
): Promise<{ applied: boolean }> {
  if (!executedBy) throw new LeagueFundingError('an executor is required');

  const req = await LeagueFundingModel.findOneAndUpdate(
    { _id: requestId, state: { $in: ['APPROVED', 'EXECUTING'] } },
    { $set: { state: 'EXECUTING', executedBy } },
    { new: true },
  ).lean();
  if (!req) {
    const current = await LeagueFundingModel.findById(requestId).lean();
    if (!current) throw new LeagueFundingError(`no such request: ${requestId}`);
    throw new LeagueFundingError(`request is ${current.state}, not APPROVED`);
  }

  const inventory = await ensureInventory(req.leagueId);
  const amount = Money.fromDecimal128(req.amount);

  const [from, to, type] =
    req.kind === 'TOPUP'
      ? ([treasuryAccountId, inventory, LedgerType.LEAGUE_TOPUP] as const)
      : ([inventory, treasuryAccountId, LedgerType.LEAGUE_CASHOUT] as const);

  let result: Awaited<ReturnType<typeof transfer>>;
  try {
    result = await transfer({
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
  } catch (err) {
    // No money moved. Hand the claim back so the request can be re-executed or
    // rejected — a failed transfer must not leave it wedged in EXECUTING.
    await LeagueFundingModel.updateOne(
      { _id: requestId, state: 'EXECUTING' },
      { $set: { state: 'APPROVED' } },
    ).catch(() => {
      // The revert itself failing leaves EXECUTING, which the claim above
      // accepts on retry. Recoverable either way; the original error matters more.
    });
    throw err;
  }

  await LeagueFundingModel.updateOne(
    { _id: requestId, state: 'EXECUTING' },
    { $set: { state: 'EXECUTED' } },
  );
  return { applied: result.applied ?? true };
}

/** Outstanding requests, for the admin review queue. */
export async function pendingLeagueFunding(): Promise<LeagueFundingDoc[]> {
  return LeagueFundingModel.find({ state: { $in: ['REQUESTED', 'APPROVED'] } })
    .sort({ createdAt: 1 })
    .lean();
}
