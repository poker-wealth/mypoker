// Global Jest setup. Keep this light — it runs before every test file.
// Integration tests that need MongoDB spin up their own MongoMemoryReplSet via test/db-helper.ts
// (added in M1), so we do not boot a database here.

import { setAlertHandler } from '../src/lib/alert';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';

// Default ops alerts to a no-op in tests (silences harmless 50ms-timing warnings from the
// in-memory server). Tests that assert an alert fired install their own spy via setAlertHandler.
beforeEach(() => setAlertHandler(() => {}));
