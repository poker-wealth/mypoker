import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/db/connection';

/**
 * Integration-test database: a real MongoDB single-node REPLICA SET in memory.
 *
 * A replica set (not a standalone) is required so multi-document transactions work — exactly the
 * environment the Financial Core's transfer()/settlement code depends on. No system install needed.
 */

let replSet: MongoMemoryReplSet | undefined;

export async function startTestDb(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await connectDb({ uri: replSet.getUri('fairplay_fc_test') });
}

export async function stopTestDb(): Promise<void> {
  await disconnectDb();
  if (replSet) {
    await replSet.stop();
    replSet = undefined;
  }
}

/** Build all declared indexes (unique constraints) for the given models before assertions. */
export async function ensureIndexes(...models: Array<{ init: () => Promise<unknown> }>): Promise<void> {
  await Promise.all(models.map((m) => m.init()));
}

/** Wipe all documents between tests without tearing down the server. */
export async function clearCollections(): Promise<void> {
  const { collections } = mongoose.connection;
  for (const name of Object.keys(collections)) {
    await collections[name]!.deleteMany({});
  }
}
