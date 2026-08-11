import mongoose from 'mongoose';

/**
 * The gateway's database — home of the identity/user store.
 *
 * Auth (email/phone/Google accounts) belongs to the gateway, not to the money
 * core: financial-core is money-only and merely verifies the JWT the gateway
 * issues. So the user store lives here, in the gateway's own database.
 *
 * Uses the same MongoDB instance as financial-core (a shared Atlas cluster is
 * fine) but its own collection — the boundary is ownership, not the server.
 */

let connected = false;

export async function connectDb(uri: string, tls = false): Promise<void> {
  if (connected) return;
  if (!uri) throw new Error('MONGO_URI is required for the gateway user store');
  await mongoose.connect(uri, { tls, serverSelectionTimeoutMS: 8000 });
  connected = true;
}

export async function disconnectDb(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}
