import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startServer, type RunningServer } from '../src/index';

/**
 * Proves the REAL production boot path: startServer() loads config from the environment, connects
 * to the configured MongoDB, starts the HTTP server, serves a request, and shuts down cleanly.
 * (We point MONGO_URI at an in-memory replica set so the test needs no external services — but the
 * code path exercised is the exact one that runs in deployment.)
 */
describe('production server boot (startServer)', () => {
  let rs: MongoMemoryReplSet;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  });
  afterAll(async () => {
    process.env = savedEnv;
    await rs.stop();
  });

  it('boots, connects to the configured DB, and serves /health', async () => {
    // Configure the environment exactly as a real deployment would (these would come from .env).
    process.env.MONGO_URI = rs.getUri('fc_boot');
    process.env.INTERNAL_API_SECRET = 'boot-internal-secret';
    process.env.JWT_SECRET = 'boot-jwt-secret';
    process.env.PORT = '0'; // OS-assigned ephemeral port
    // Pinned, not merely left unset: loadConfig() runs dotenv, so a developer's
    // real .env leaks in for anything this test doesn't set. A .env pointing at
    // Atlas carries MONGO_TLS=true, and a TLS handshake against the plain
    // in-memory mongod fails with an opaque ECONNRESET that looks like a bug in
    // the boot path rather than in the test's isolation.
    process.env.MONGO_TLS = 'false';

    let running: RunningServer | undefined;
    try {
      running = await startServer();
      expect(running.port).toBeGreaterThan(0);

      const res = await fetch(`http://127.0.0.1:${running.port}/api/v1/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: 'ok', service: 'financial-core' });
    } finally {
      if (running) await running.close(); // graceful shutdown must not throw
    }
  });

  it('refuses to boot with missing required configuration', async () => {
    delete process.env.MONGO_URI;
    delete process.env.JWT_SECRET;
    process.env.INTERNAL_API_SECRET = 'x'; // too short / partial config
    await expect(startServer()).rejects.toThrow(/Invalid environment configuration/);
  });
});
