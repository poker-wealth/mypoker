/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  // mongodb-memory-server can need a moment to download the binary on first run.
  testTimeout: 60000,
  // Every integration file boots its OWN MongoMemoryReplSet (see test/db-helper.ts).
  // At Jest's default worker count that is one replica set per core, and the
  // elections thrash hard enough to blow the 60s timeout — settlement, the
  // slowest and least skippable suite, is the one that loses. Capping is also
  // simply faster here: 49s at 2 workers against 73s uncapped.
  maxWorkers: 2,
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
};
