import { SecurityLogModel } from '../security/security-log.model';

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
