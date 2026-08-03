import { randomUUID } from 'node:crypto';
import mongoose, { Schema, type Model } from 'mongoose';

/**
 * security_log — append-only record of security-relevant events (illegal fund flows, address
 * mismatches, etc.). Written whenever a circuit breaker fires. In production this is mirrored to
 * remote syslog so it cannot be deleted (spec §11.2).
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

export const SecurityLogModel: Model<SecurityEventDoc> =
  (mongoose.models.SecurityLog as Model<SecurityEventDoc>) ??
  mongoose.model<SecurityEventDoc>('SecurityLog', securityLogSchema);
