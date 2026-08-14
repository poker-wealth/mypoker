import { randomUUID } from 'node:crypto';
import mongoose, { Schema, type Model } from 'mongoose';
import { mirrorToSyslog } from '../lib/syslog';

/**
 * security_log — append-only record of security-relevant events (illegal fund flows, address
 * mismatches, etc.). Written whenever a circuit breaker fires. In production this is mirrored to
 * remote syslog so it cannot be deleted (spec §11.2).
 *
 * The mirror is a post-save hook, not a call-site change: EVERY writer (breakers.ts trip(),
 * transfer()'s CB6, deposit-credit's non-official-contract log) is covered by construction, and a
 * new writer inherits it for free. The hook is fire-and-forget and never throws, so it cannot fail
 * the DB write it shadows.
 */

export interface SecurityEventDoc {
  _id: string;
  event: string;
  detail: Record<string, unknown>;
  createdAt: Date;
}

const securityLogSchema = new Schema<SecurityEventDoc>(
  {
    _id: { type: String, default: (): string => randomUUID() },
    event: { type: String, required: true, index: true },
    detail: { type: Schema.Types.Mixed, required: true, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, minimize: false },
);

// Mirror every persisted event to remote syslog (§11.2). Runs after the Mongo write commits, so the
// canonical record is safe first; the mirror is a best-effort copy that leaves the box regardless.
securityLogSchema.post('save', function (doc: SecurityEventDoc): void {
  mirrorToSyslog(doc.event, doc.detail, doc.createdAt);
});

export const SecurityLogModel: Model<SecurityEventDoc> =
  (mongoose.models.SecurityLog as Model<SecurityEventDoc>) ??
  mongoose.model<SecurityEventDoc>('SecurityLog', securityLogSchema);
