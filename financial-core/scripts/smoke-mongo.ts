/**
 * A shared in-memory MongoDB replica set for local smoke testing.
 *
 * Both financial-core and the gateway need a replica set (transactions), and
 * this machine has neither Docker nor a local mongod. This starts one, writes
 * its URI where the other processes can read it, and stays up until killed.
 *
 *   npx ts-node scripts/smoke-mongo.ts <uri-output-file>
 */
import { writeFileSync } from 'node:fs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) throw new Error('usage: smoke-mongo.ts <uri-output-file>');

  const rs = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = rs.getUri();
  writeFileSync(out, uri, 'utf8');
  console.log(`[smoke-mongo] up: ${uri}`);

  const stop = async (): Promise<void> => {
    await rs.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {}, 1 << 30); // stay alive
}

main().catch((err) => {
  console.error('[smoke-mongo] failed:', err);
  process.exit(1);
});
