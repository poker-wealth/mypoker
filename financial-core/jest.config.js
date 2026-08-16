/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  // mongodb-memory-server can need a moment to download the binary on first run.
  testTimeout: 60000,
  // Every integration file boots its OWN MongoMemoryReplSet (see test/db-helper.ts),
  // so concurrency here means concurrent replica sets, and their elections thrash
  // hard enough to blow the 60s timeout. Whichever suite is heaviest loses: it was
  // settlement at the default worker count, then the HTTP suite once the auth and
  // TRON work added three more replica sets at 2 workers.
  //
  // Serialised is not the slow option, it is the fast one — the contention costs
  // more than the parallelism wins:
  //   default workers  73s, failing
  //   2 workers       100s, failing (28 suites)
  //   1 worker         84s, green
  //
  // The real fix is a shared replica set across suites rather than one each; until
  // then this is deterministic, and a green suite that takes 84s beats a flaky one
  // that takes 100s.
  maxWorkers: 1,
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
};
