/**
 * A standalone in-memory MongoDB replica set on a FIXED port.
 *
 *   npm run dev:mongo        (from financial-core)
 *
 * Why this exists: `game-server/.env` has to name a MONGO_URI, and until now the only way to get a
 * local Mongo was `mongodb-memory-server` picking a RANDOM port inside some other process. Someone
 * pasted that port into `.env`, and the moment that process exited the gateway could no longer
 * start — "gateway failed to start — database: connect ECONNREFUSED 127.0.0.1:61293" — with the
 * dead port baked into a committed-adjacent file. A fixed port means the URI in `.env` stays true
 * across restarts.
 *
 * A REPLICA SET, not a standalone: financial-core settles through `transfer()`, which uses Mongo
 * transactions, and transactions require a replica set. A standalone mongod fails those writes at
 * commit — late, and looking like a money bug rather than a topology one.
 *
 * Data is in memory and discarded on exit. This is a development convenience; it is not a database
 * anything real should point at.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/** Fixed so `.env` can name it. 47017 to stay clear of a real local mongod on 27017. */
const PORT = Number(process.env.DEV_MONGO_PORT ?? 47017);
const REPL_SET = 'rs0';

async function main(): Promise<void> {
  const rs = await MongoMemoryReplSet.create({
    replSet: { name: REPL_SET, count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ port: PORT }],
  });

  const uri = `mongodb://127.0.0.1:${PORT}/mypoker?replicaSet=${REPL_SET}`;
  console.log('\n  in-memory MongoDB replica set is up\n');
  console.log(`  MONGO_URI=${uri}`);
  console.log('  MONGO_TLS=false');
  console.log('\n  Put those two lines in game-server/.env. Ctrl+C to stop; data is discarded.\n');

  const shutdown = async (): Promise<void> => {
    await rs.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main().catch((err) => {
  console.error('dev-mongo failed to start:', err);
  process.exit(1);
});
