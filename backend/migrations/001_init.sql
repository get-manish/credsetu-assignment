-- MiniLedger initial schema. Safe to run more than once (IF NOT EXISTS everywhere).

-- gen_random_uuid() lives in pgcrypto on older Postgres versions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per OTP we send. We store only a hash, never the code itself.
CREATE TABLE IF NOT EXISTS otps (
  id         SERIAL PRIMARY KEY,
  phone      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INT NOT NULL DEFAULT 0,
  used       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Speeds up the rate-limit and "latest OTP" lookups.
CREATE INDEX IF NOT EXISTS idx_otps_phone_created ON otps (phone, created_at DESC);

CREATE TABLE IF NOT EXISTS loans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_name TEXT NOT NULL,
  -- NUMERIC (not FLOAT) so money is exact: 0.1 + 0.2 really is 0.3.
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  due_date    DATE NOT NULL,
  is_repaid   BOOLEAN NOT NULL DEFAULT false,
  repaid_at   TIMESTAMPTZ NULL,
  receipt_url TEXT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loans_user_due ON loans (user_id, due_date);
