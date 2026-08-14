import { randomUUID } from 'node:crypto';
import mongoose, { Schema, type Model } from 'mongoose';
import { shipToSyslog } from './syslog';

/**
 * security_log — append-only record of security-relevant events (illegal fund flows, address
 * mismatches, etc.). Written whenever a circuit breaker fires. Every write is mirrored to remote
 * syslog (the post-save hook below) so a copy exists off-box.
 *
 * That mirror is an APPLICATION-level ship of this collection. It is not spec §11.2, which asks
 * for MongoDB's own audit log (Enterprise auditing + RBAC, configured on the cluster) shipped to
 * syslog so a DBA's actions are recorded by a layer the DBA does not control — see the honest
 * accounting at the top of ./syslog.ts. One protects against events nobody wrote here; this
 * protects the ones somebody did.
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

/**
 * Mirror every write to remote syslog.
 *
 * A post-save hook rather than a call at each site, because there are three
 * writers today and the next one will be added by someone who has never read
 * this file. Hanging it on the schema makes the mirror impossible to forget —
 * a security log that is shipped "wherever we remembered" is not shipped.
 *
 * After the save, never before: the database write is the durable record, and
 * a log line about an event that failed to persist would be worse than none.
 * shipToSyslog never throws and never blocks, so this cannot fail a save.
 */
securityLogSchema.post('save', function postSave(doc: SecurityEventDoc): void {
  shipToSyslog({ id: doc._id, event: doc.event, detail: doc.detail, at: doc.createdAt });
});

export const SecurityLogModel: Model<SecurityEventDoc> =
  (mongoose.models.SecurityLog as Model<SecurityEventDoc>) ??
  mongoose.model<SecurityEventDoc>('SecurityLog', securityLogSchema);
