import { randomUUID } from 'node:crypto';
import mongoose, { Schema, type Model } from 'mongoose';

/**
 * The admin audit log — one document per administrative write.
 *
 * WHY THIS EXISTS AT ALL: the point of an admin panel that can edit anything is
 * that someone can edit anything. The control that makes that acceptable is not
 * a narrower panel, it is that every change is attributable afterwards. An edit
 * nobody can be named for is indistinguishable from a compromise.
 *
 * `before` and `after` are stored rather than a diff, because a diff is only
 * meaningful against a version of the record you still have. Six months later,
 * the row is the only surviving evidence of what the account looked like.
 *
 * Deliberately APPEND-ONLY: there is no update or delete path anywhere in the
 * codebase, and none should be added. A log an administrator can edit records
 * only the changes they chose to leave.
 *
 * Never stores a password, a hash, or an OTP. `adminSetPassword` writes an entry
 * saying that a password was set, and nothing about what it was set to.
 */
export interface AdminAuditDoc {
  _id: string;
  /** playerId of the administrator, from the verified token — never the body. */
  actorPlayerId: string;
  /** The account acted upon. */
  subjectPlayerId: string;
  action: AdminAuditAction;
  /** Field-level state either side of the write. Omitted for actions with none. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Free text the administrator supplied (a suspension reason, a note). */
  reason?: string;
  createdAt: Date;
}

export type AdminAuditAction =
  | 'user.update'
  | 'user.suspend'
  | 'user.reinstate'
  | 'user.set_password'
  | 'user.clear_avatar'
  | 'user.balance_adjust';

const adminAuditSchema = new Schema<AdminAuditDoc>(
  {
    _id: { type: String, default: (): string => `aud-${randomUUID()}` },
    actorPlayerId: { type: String, required: true, index: true },
    subjectPlayerId: { type: String, required: true, index: true },
    action: { type: String, required: true },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    reason: { type: String },
  },
  {
    // createdAt only. An audit row has no meaningful "updated" — if one is ever
    // updated, that is the bug, and a field inviting it does not belong here.
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: 'admin_audit',
  },
);

export const AdminAuditModel: Model<AdminAuditDoc> =
  (mongoose.models.AdminAudit as Model<AdminAuditDoc>) ??
  mongoose.model<AdminAuditDoc>('AdminAudit', adminAuditSchema);
