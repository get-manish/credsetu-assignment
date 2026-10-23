/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  // Loads the test DATABASE_URL before any app code is imported.
  setupFiles: ['<rootDir>/tests/setupEnv.ts'],
  testTimeout: 15000,
};
