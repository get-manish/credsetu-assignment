// Runs before any test file (see jest.config.js), so config.ts sees the TEST database.
import dotenv from 'dotenv';

dotenv.config();

const testUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://miniledger:miniledger@localhost:5432/miniledger_test';

// Safety net: the tests TRUNCATE tables, so refuse to run against anything not named *test*.
if (!/test/i.test(new URL(testUrl).pathname)) {
  throw new Error(`Refusing to run tests: "${testUrl}" does not look like a test database`);
}

process.env.DATABASE_URL = testUrl;
process.env.JWT_SECRET = 'test-secret';
process.env.OTP_TTL_MINUTES = '5';
