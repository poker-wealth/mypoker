import { AccountType, LedgerType } from '../domain/account-types';
import { Money } from '../domain/money';
import { AccountModel } from '../wallet/account.model';
import { getOrCreatePlayerAccount } from '../wallet/system-accounts';
import { transfer } from '../wallet/transfer';
import { leagueInventoryId } from './league-funding';

/**
 * League grants — a league putting its own inventory into a member's league
 * wallet (`transfer(LEAGUE_INVENTORY, PLAYER, LEAGUE_GRANT)`).
 *
 * WHY THIS EXISTS
 *
 * The league economy had an on-ramp and an off-ramp but no way to reach a
 * player. The spec covers TREASURY → LEAGUE_INVENTORY (top-up), the reverse
 * (cash-out), rake into inventory and seized chips into inventory — and the
 * clearing rules whitelist LEAGUE_INVENTORY → PLAYER — but nothing performed
 * that transfer. Deposits credit the PLATFORM wallet, and a league buy-in
 * resolves a league-SCOPED account (the spec's dual-wallet isolation), so a
 * member's league wallet was permanently empty: league tables could be created
 * and would settle their rake correctly, but nobody could ever sit down.
 *
 * WHY ONE LEAGUE ADMIN, AND NOT PLATFORM OPS
 *
 * A top-up needs platform ops because platform money crosses into a league; a
 * cash-out needs ops and a second signature because money leaves the league
 * boundary. A grant moves the league's OWN money to its OWN member and the
 * total inside the league is unchanged — no platform funds move.
 *
 * The containment that makes this safe: league chips CANNOT be withdrawn.
 * `/me/withdrawals` resolves the platform-scoped account
 * (`getOrCreatePlayerAccount(playerId)` with no scope), so a granted balance
 * can only be played inside the league or returned to the platform through a
 * cash-out — which is ops-reviewed and two-person above the threshold. A rogue
 * league admin granting themselves chips therefore cannot convert them to real
 * money without passing the controls that already exist.
 *
 * IDEMPOTENCY IS THE CALLER'S TO SUPPLY, AND IT IS REQUIRED
 *
 * `reference` used to be optional, falling back to a fresh UUID per call — so
 * two identical POSTs charged the league twice and credited the member twice.
 * The comment here claimed "the route supplies one"; no route did. Caught in
 * review after merge.
 *
 * It is now required, and deliberately not derivable server-side:
 *
 *   Minting one per HTTP request does not help — two requests, two references,
 *   same double-pay one layer up.
 *
 *   Deriving it from the content (league + player + amount + a time bucket)
 *   would collapse a genuine second grant of the same size on the same day into
 *   silence, which is a worse bug than the one it fixes: money the league
 *   believes it sent, never sent.
 *
 * So the caller decides what "the same grant" means — generated once when an
 * admin commits to the action and reused on retry, the way an idempotency key
 * is meant to work.
 */

export class LeagueGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeagueGrantError';
  }
}

export interface GrantInput {
  leagueId: string;
  /** The member receiving chips, in THAT league's wallet scope. */
  playerId: string;
  amount: Money;
  /** The league admin making the grant — from a verified token, never a body. */
  grantedBy: string;
  /**
   * Idempotency key. REQUIRED: it is the only thing standing between a
   * double-submit and a double payment. Stable across retries of the SAME
   * intended grant, different for a genuinely new one.
   */
  reference: string;
}

export interface GrantResult {
  grantId: string;
  leagueId: string;
  playerId: string;
  amount: string;
  applied: boolean;
}

/**
 * Move chips from a league's inventory into a member's league wallet.
 *
 * Fails rather than creating anything it should not: an unknown/absent league
 * inventory, a non-positive amount, or an inventory without the funds are all
 * refused by `transfer()`'s own guards (whitelist, overdraft, idempotency) —
 * this function adds the league-specific ones on top.
 */
export async function grantToMember(input: GrantInput): Promise<GrantResult> {
  if (!input.grantedBy) throw new LeagueGrantError('a granter is required');
  if (!input.amount.isPositive()) throw new LeagueGrantError('a grant must be greater than zero');

  const inventoryId = leagueInventoryId(input.leagueId);
  const inventory = await AccountModel.findById(inventoryId).lean();
  // Deliberately NOT get-or-create: an inventory that does not exist has never
  // been funded, and conjuring an empty one here would turn "this league has no
  // money" into a confusing overdraft error one layer down.
  if (!inventory) {
    throw new LeagueGrantError(`league ${input.leagueId} has no inventory to grant from`);
  }

  // The member's wallet in THIS league's scope — never their platform wallet.
  // Granting into the platform scope would hand league money to the open
  // economy, where it could be withdrawn, and would break the isolation the
  // spec calls a "critical isolation failure".
  const wallet = await getOrCreatePlayerAccount(input.playerId, input.leagueId);
  if (wallet.accountType !== AccountType.PLAYER) {
    throw new LeagueGrantError('grants may only credit PLAYER accounts');
  }

  if (!input.reference) throw new LeagueGrantError('a grant reference is required');
  const grantId = input.reference;
  const result = await transfer({
    fromAccountId: inventoryId,
    toAccountId: wallet._id,
    amount: input.amount,
    type: LedgerType.LEAGUE_GRANT,
    businessId: grantId,
    idempotencyKey: `league:grant:${grantId}`,
    metadata: { leagueId: input.leagueId, playerId: input.playerId, grantedBy: input.grantedBy },
  });

  return {
    grantId,
    leagueId: input.leagueId,
    playerId: input.playerId,
    amount: input.amount.toString(),
    applied: result.applied ?? true,
  };
}
