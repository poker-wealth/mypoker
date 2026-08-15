import { Money } from '../domain/money';
import { WithdrawalState } from '../domain/withdrawal-types';
import { AccountModel } from '../wallet/account.model';
import { WithdrawalModel } from '../withdrawal/withdrawal.model';
import { getVolumeFacts } from '../vip/volume-tracker';

/**
 * The withdrawal review queue (SAMUEL.md task 3, screen 2; 12-week plan W10
 * "withdrawal queue management: list, approve/reject, filter by amount/VIP/
 * status").
 *
 * Facts only. Whether an amount is "large" is a rule and lives with the state
 * machine that enforces it — this reports the amount and who has already
 * signed, and the client renders a second confirm because the server will
 * refuse a single one anyway. The UI's two-step confirm is a courtesy to the
 * administrator, not the control; the control is in approveWithdrawal.
 *
 * Cumulative volume comes along so the queue can be filtered by VIP tier. The
 * tier itself is derived in the gateway, from the same ladder the player's own
 * profile uses — an admin and a player must not see different tiers.
 */
export interface QueuedWithdrawal {
  withdrawalId: string;
  playerId: string;
  playerAccountId: string;
  /** Decimal string, USD. */
  amount: string;
  address: string;
  state: WithdrawalState;
  /** Ops who have already approved. Empty until someone does. */
  approvals: string[];
  /** For the VIP filter; the gateway turns it into a tier. */
  cumulativeEffective: number;
  requestedAt: string;
}

/**
 * Everything awaiting a human.
 *
 * REQUESTED and APPROVED both appear. An APPROVED withdrawal has had its funds
 * held but not sent, and it is still something an operator must act on —
 * dropping it from the queue at approval would hide money that is mid-flight
 * from the only screen that watches it.
 */
export async function getWithdrawalQueue(limit = 200): Promise<QueuedWithdrawal[]> {
  const rows = await WithdrawalModel.find({
    state: { $in: [WithdrawalState.REQUESTED, WithdrawalState.APPROVED] },
  })
    .sort({ createdAt: 1 }) // oldest first — a queue, not a feed
    .limit(Math.min(limit, 500))
    .lean();

  if (rows.length === 0) return [];

  // The withdrawal carries an ACCOUNT id; the queue needs the player behind it.
  const accounts = await AccountModel.find(
    { _id: { $in: rows.map((r) => r.playerAccountId) } },
    { ownerId: 1 },
  ).lean();
  const ownerOf = new Map(accounts.map((a) => [a._id, a.ownerId]));

  return Promise.all(
    rows.map(async (r) => {
      const playerId = ownerOf.get(r.playerAccountId) ?? r.playerAccountId;
      const volume = await getVolumeFacts(playerId);
      return {
        withdrawalId: r._id,
        playerId,
        playerAccountId: r.playerAccountId,
        amount: Money.fromDecimal128(r.amount).toString(),
        address: r.address,
        state: r.state,
        approvals: r.approvals ?? [],
        cumulativeEffective: volume.cumulativeEffective,
        requestedAt: r.createdAt.toISOString(),
      };
    }),
  );
}
