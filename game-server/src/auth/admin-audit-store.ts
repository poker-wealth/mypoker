import mongoose, { type ClientSession } from 'mongoose';
import { AdminAuditModel, type AdminAuditAction, type AdminAuditDoc } from './admin-audit.model';

/**
 * Run an admin write and its audit entry as ONE atomic unit.
 *
 * Every write route used to apply the change and then write the log. If the log
 * insert failed the caller got a 500 on a change that had already happened,
 * with no record of it — the exact state the model header calls impossible.
 * Ordering alone cannot fix that: audit-first has the mirror flaw, a log
 * claiming a change that never landed.
 *
 * Requires a replica set, as MongoDB transactions do. That is already this
 * platform's standard — financial-core's `transfer()` has depended on one since
 * it was written — so it is a deployment requirement the gateway now shares
 * rather than a new one.
 *
 * Falls back to running the function WITHOUT a session when the deployment has
 * no transaction support, rather than failing every admin write outright. The
 * fallback is logged loudly, because it silently reintroduces the very gap this
 * closes and nobody should discover that from a missing audit row months later.
 */
export async function withAuditTransaction<T>(fn: (session?: ClientSession) => Promise<T>): Promise<T> {
  let session: ClientSession;
  try {
    session = await mongoose.startSession();
  } catch {
    console.warn('[admin-audit] no session support — write and audit are NOT atomic');
    return fn(undefined);
  }

  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result!;
  } catch (err) {
    // A deployment without transactions rejects at commit with a specific
    // error. Anything else is a real failure and must propagate — swallowing it
    // would turn a rolled-back write into an apparent success.
    const message = err instanceof Error ? err.message : String(err);
    if (/Transaction numbers are only allowed|replica set|not supported/i.test(message)) {
      console.warn(`[admin-audit] transactions unavailable (${message}) — falling back, NOT atomic`);
      return fn(undefined);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Reading and writing the admin audit log.
 *
 * Two functions and no third: append, and read back. There is no update and no
 * delete, and that absence is the control — see the model's header.
 */

export interface AuditEntry {
  id: string;
  actorPlayerId: string;
  subjectPlayerId: string;
  action: AdminAuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  at: string;
}

/**
 * Reduce a before/after pair to only what actually changed.
 *
 * Storing whole records would bury the one edited field among fifteen unchanged
 * ones, and an audit entry nobody can read at a glance is one nobody reads. The
 * full record is still recoverable: `before` holds the previous value of every
 * key that moved, which is exactly what an investigation needs.
 *
 * Compared with `JSON.stringify` rather than `!==` so that a Date or a nested
 * object compares by value. Two structurally identical objects are not the same
 * reference, and a reference check would report every field as changed on every
 * write — an audit log that always says "everything changed" says nothing.
 */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  ignore: readonly string[] = AUDIT_IGNORED_KEYS,
): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  const skip = new Set(ignore);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (skip.has(k)) continue;
    const key = k as keyof T;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a };
}

/**
 * Bookkeeping fields that move on every write and mean nothing as an edit.
 *
 * `updatedAt` in particular changes on EVERY save, so without this every audit
 * entry carries it — and the one field the administrator actually changed sits
 * next to a timestamp diff that is true of every row in the log. The entry's own
 * `createdAt` already records when it happened.
 */
export const AUDIT_IGNORED_KEYS: readonly string[] = ['updatedAt', 'createdAt', 'playerId'];

const toEntry = (d: AdminAuditDoc): AuditEntry => ({
  id: d._id,
  actorPlayerId: d.actorPlayerId,
  subjectPlayerId: d.subjectPlayerId,
  action: d.action,
  before: d.before ?? null,
  after: d.after ?? null,
  reason: d.reason ?? null,
  at: d.createdAt.toISOString(),
});

export const adminAudit = {
  /**
   * Append one entry.
   *
   * Returns void and is awaited by every caller. NOT fire-and-forget: an audit
   * write that fails silently leaves an action taken with no record of it, which
   * is the exact state this log exists to make impossible. If the log cannot be
   * written the request should fail — better a retry than an unattributed edit.
   */
  async record(
    input: {
      actorPlayerId: string;
      subjectPlayerId: string;
      action: AdminAuditAction;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
      reason?: string;
    },
    session?: ClientSession,
  ): Promise<void> {
    await AdminAuditModel.create(
      [
        {
          actorPlayerId: input.actorPlayerId,
          subjectPlayerId: input.subjectPlayerId,
          action: input.action,
          ...(input.before ? { before: input.before } : {}),
          ...(input.after ? { after: input.after } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        },
      ],
      // The array form is required to pass a session — `create(doc, {session})`
      // silently treats the options object as a second DOCUMENT.
      session ? { session, ordered: true } : { ordered: true },
    );
  },

  /** Newest first — an audit trail is read from the most recent action back. */
  async forSubject(subjectPlayerId: string, limit: number): Promise<AuditEntry[]> {
    const docs = await AdminAuditModel.find({ subjectPlayerId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return docs.map((d) => toEntry(d as AdminAuditDoc));
  },
};
