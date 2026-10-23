import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { closeDatabase, requestOtpAndCapture, resetDatabase, setupDatabase } from './helpers';

const PHONE = '+919876543210';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(closeDatabase);

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('POST /auth/request-otp', () => {
  it('rejects an invalid phone number', async () => {
    const res = await request(app).post('/auth/request-otp').send({ phone: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details[0].field).toBe('phone');
  });

  it('rejects a missing phone', async () => {
    const res = await request(app).post('/auth/request-otp').send({});
    expect(res.status).toBe(400);
  });

  it('sends an OTP, stores only a hash, and never returns the code', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await request(app).post('/auth/request-otp').send({ phone: PHONE });
    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n');
    spy.mockRestore();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'OTP sent' });
    expect(logged).toMatch(/\[MOCK OTP\] \+919876543210 -> \d{6}/);

    const code = logged.match(/-> (\d{6})/)![1];
    expect(JSON.stringify(res.body)).not.toContain(code);

    const rows = await pool.query('SELECT code_hash FROM otps WHERE phone = $1', [PHONE]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    expect(rows.rows[0].code_hash).not.toContain(code);
  });

  it('rate-limits to 5 requests per phone per 10 minutes', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    for (let i = 0; i < 5; i++) {
      await request(app).post('/auth/request-otp').send({ phone: PHONE }).expect(200);
    }
    const sixth = await request(app).post('/auth/request-otp').send({ phone: PHONE });
    spy.mockRestore();

    expect(sixth.status).toBe(429);
    // A different phone is not affected.
    const other = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await request(app).post('/auth/request-otp').send({ phone: '+919000000001' }).expect(200);
    other.mockRestore();
  });
});

describe('POST /auth/verify-otp', () => {
  it('completes the full login flow and returns a working token', async () => {
    const otp = await requestOtpAndCapture(PHONE);
    const res = await request(app).post('/auth/verify-otp').send({ phone: PHONE, otp });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.phone).toBe(PHONE);
    expect(res.body.user.id).toMatch(/^[0-9a-f-]{36}$/);

    // The token opens protected routes.
    const loans = await request(app).get('/loans').set('Authorization', `Bearer ${res.body.token}`);
    expect(loans.status).toBe(200);
    expect(loans.body).toEqual([]);
  });

  it('logs the same user in again (upsert, not duplicate)', async () => {
    const first = await request(app)
      .post('/auth/verify-otp')
      .send({ phone: PHONE, otp: await requestOtpAndCapture(PHONE) });
    const second = await request(app)
      .post('/auth/verify-otp')
      .send({ phone: PHONE, otp: await requestOtpAndCapture(PHONE) });

    expect(second.body.user.id).toBe(first.body.user.id);
    const count = await pool.query('SELECT COUNT(*) FROM users');
    expect(count.rows[0].count).toBe('1');
  });

  it('rejects a wrong OTP with 401', async () => {
    const otp = await requestOtpAndCapture(PHONE);
    const wrong = otp === '000000' ? '111111' : '000000';
    const res = await request(app).post('/auth/verify-otp').send({ phone: PHONE, otp: wrong });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Incorrect OTP');
  });

  it('rejects when no OTP was requested', async () => {
    const res = await request(app).post('/auth/verify-otp').send({ phone: PHONE, otp: '123456' });
    expect(res.status).toBe(401);
  });

  it('does not allow an OTP to be used twice', async () => {
    const otp = await requestOtpAndCapture(PHONE);
    await request(app).post('/auth/verify-otp').send({ phone: PHONE, otp }).expect(200);
    const again = await request(app).post('/auth/verify-otp').send({ phone: PHONE, otp });
    expect(again.status).toBe(401);
  });

  it('rejects an expired OTP', async () => {
    const otp = await requestOtpAndCapture(PHONE);
    await pool.query(`UPDATE otps SET expires_at = now() - interval '1 minute'`);
    const res = await request(app).post('/auth/verify-otp').send({ phone: PHONE, otp });
    expect(res.status).toBe(401);
  });

  it('locks the OTP after 5 wrong attempts, even if the right code is sent next', async () => {
    const otp = await requestOtpAndCapture(PHONE);
    const wrong = otp === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await request(app).post('/auth/verify-otp').send({ phone: PHONE, otp: wrong }).expect(401);
    }
    const res = await request(app).post('/auth/verify-otp').send({ phone: PHONE, otp });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Too many incorrect attempts/);
  });

  it('validates the OTP format', async () => {
    const res = await request(app).post('/auth/verify-otp').send({ phone: PHONE, otp: '12' });
    expect(res.status).toBe(400);
  });
});
