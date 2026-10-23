import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { runMigrations } from '../scripts/migrate';

// Build the schema once per test file.
export async function setupDatabase(): Promise<void> {
  // Silence the "Applied migration" log lines in test output.
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  await runMigrations(pool);
  log.mockRestore();
}

// Empty every table so each test starts from a known state.
export async function resetDatabase(): Promise<void> {
  await pool.query('TRUNCATE loans, otps, users RESTART IDENTITY CASCADE');
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

// Requests an OTP and captures it by spying on console.log
// (the mock "SMS" is just a log line: "[MOCK OTP] <phone> -> <code>").
export async function requestOtpAndCapture(phone: string): Promise<string> {
  const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await request(app).post('/auth/request-otp').send({ phone }).expect(200);
    const line = spy.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[MOCK OTP]'));
    const match = line?.match(/-> (\d{6})$/);
    if (!match) throw new Error('OTP was not logged');
    return match[1];
  } finally {
    spy.mockRestore();
  }
}

// Full login: returns a token and the user id.
export async function login(phone: string): Promise<{ token: string; userId: string }> {
  const otp = await requestOtpAndCapture(phone);
  const res = await request(app).post('/auth/verify-otp').send({ phone, otp }).expect(200);
  return { token: res.body.token as string, userId: res.body.user.id as string };
}

// Convenience: create a loan through the API.
export async function createLoan(
  token: string,
  body: { friend_name: string; amount: number; due_date: string },
): Promise<{ id: string }> {
  const res = await request(app).post('/loans').set('Authorization', `Bearer ${token}`).send(body).expect(201);
  return res.body as { id: string };
}

// 'YYYY-MM-DD' for today +/- n days (UTC; the tests only need "clearly future" / "clearly past").
export function dateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
