import dotenv from 'dotenv';
import path from 'path';

// Read variables from backend/.env into process.env (no-op if the file is missing).
dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://miniledger:miniledger@localhost:5432/miniledger',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES ?? 5),
  // Where uploaded receipts are written and served from.
  uploadsDir: path.resolve(__dirname, '..', 'uploads'),
  // Business rules kept in one place so tests and code agree.
  otpMaxAttempts: 5,
  otpRequestLimit: 5, // max OTP requests ...
  otpRequestWindowMinutes: 10, // ... per phone in this window
  maxUploadBytes: 5 * 1024 * 1024,
};
