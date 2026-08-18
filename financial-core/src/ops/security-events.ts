import { SecurityLogModel } from '../security/security-log.model';
import { alertOps } from '../lib/alert';

/**
 * Recent security-log entries, for the admin Alerts screen (SAMUEL.md task 3,
 * screen 5).
 *
 * Facts only, newest first. No severity is assigned here: severity is a
 * judgment about how much an event matters, and judgments live in the gateway
 * with the rest of the rules. financial-core records what happened.
 *
 * The log is append-only, so this is a read with no counterpart — an alert
 * cannot be edited or deleted from the admin panel, which is the point of
 * keeping an audit trail at all.
 */
export interface SecurityEvent {
  id: string;
  at: string;
  /** e.g. CIRCUIT_BREAKER_CB6, ILLEGAL_FUND_FLOW, NON_OFFICIAL_CONTRACT_DEPOSIT */
  event: string;
  detail: Record<string, unknown>;
}

/**
 * Record a table hand that FAILED to settle, and page ops.
 *
 * The game-server catches a settlement throw, returns the table to WAITING WITHOUT inventing any
 * correction (settleTableHand is atomic — a throw moved no money), and reports the failure here. A
 * settlement failure is a money fault: left as a console line a recurring ledger fault stays quiet,
 * which is exactly what a money platform cannot have. Mirrors the CB3 anomaly path — write the
 * append-only record first (the post-save hook mirrors it to syslog), then alert.
 */
export async function recordSettlementFailure(
  tableId: string,
  reason: string,
  roundId?: string,
): Promise<void> {
  await SecurityLogModel.create([{ event: 'SETTLEMENT_FAILURE', detail: { tableId, roundId, reason } }]);
  await alertOps(
    `Settlement failed on table ${tableId}${roundId ? ` (round ${roundId})` : ''}: ${reason}`,
    { tableId, roundId, reason },
  );
}

export async function getSecurityEvents(limit = 100): Promise<SecurityEvent[]> {
  const rows = await SecurityLogModel.find({})
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 500))
    .lean();

  return rows.map((r) => ({
    id: String(r._id),
    at: r.createdAt.toISOString(),
    event: r.event,
    detail: r.detail ?? {},
  }));
}
