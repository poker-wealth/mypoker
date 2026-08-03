import mongoose from 'mongoose';

/**
 * MongoDB connection management.
 *
 * The Financial Core REQUIRES a replica set — multi-document transactions (used by `transfer()`
 * and the settlement engine) only work against an RS. A single-node RS is fine for dev.
 */

export interface DbConfig {
  uri: string;
  /** Enable TLS in production. */
  tls?: boolean;
}

let connected = false;

export async function connectDb(config: DbConfig): Promise<typeof mongoose> {
  if (connected) return mongoose;

  // Fail fast and loud on money-layer DB errors rather than buffering silently.
  mongoose.set('bufferCommands', false);
  // Strict query: ignore unknown fields in filters (prevents silent typo-filters on balances).
  mongoose.set('strictQuery', true);

  await mongoose.connect(config.uri, {
    tls: config.tls ?? false,
    // Surface connection problems quickly instead of hanging the service.
    serverSelectionTimeoutMS: 5000,
    // The whole point of the RS: enable transactions with majority concerns by default.
    retryWrites: true,
    writeConcern: { w: 'majority' },
  });

  connected = true;
  return mongoose;
}

export async function disconnectDb(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

export function isConnected(): boolean {
  return connected;
}
