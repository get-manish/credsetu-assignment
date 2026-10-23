import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../src/app';
import { config } from '../src/config';
import { pool } from '../src/db';
import {
  closeDatabase,
  createLoan,
  dateOffset,
  login,
  resetDatabase,
  setupDatabase,
} from './helpers';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(closeDatabase);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('authentication on /loans', () => {
  it('returns 401 without a token', async () => {
    expect((await request(app).get('/loans')).status).toBe(401);
    expect((await request(app).get('/loans/summary')).status).toBe(401);
    expect((await request(app).post('/loans').send({})).status).toBe(401);
    expect((await request(app).patch('/loans/abc/repay')).status).toBe(401);
  });

  it('returns 401 for a garbage token', async () => {
    const res = await request(app).get('/loans').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});

describe('POST /loans', () => {
  it('creates a loan (JSON) and returns 201 with numeric amount', async () => {
    const { token } = await login('+919111111111');
    const res = await request(app)
      .post('/loans')
      .set(auth(token))
      .send({ friend_name: '  Rahul  ', amount: 1500.5, due_date: dateOffset(7) });

    expect(res.status).toBe(201);
    expect(res.body.friend_name).toBe('Rahul'); // trimmed
    expect(res.body.amount).toBe(1500.5); // number, not "1500.50"
    expect(res.body.due_date).toBe(dateOffset(7));
    expect(res.body.is_repaid).toBe(false);
    expect(res.body.is_overdue).toBe(false);
    expect(res.body.receipt_url).toBeNull();
  });

  it('accepts multipart/form-data with a receipt image and serves it back', async () => {
    const { token } = await login('+919111111111');
    // A 1x1 transparent PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const res = await request(app)
      .post('/loans')
      .set(auth(token))
      .field('friend_name', 'Priya')
      .field('amount', '250.75')
      .field('due_date', dateOffset(3))
      .attach('receipt', png, { filename: 'receipt.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(250.75);
    expect(res.body.receipt_url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);

    const file = await request(app).get(res.body.receipt_url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/image\/png/);

    fs.unlinkSync(path.join(config.uploadsDir, path.basename(res.body.receipt_url))); // tidy up
  });

  it('rejects a non-image receipt', async () => {
    const { token } = await login('+919111111111');
    const res = await request(app)
      .post('/loans')
      .set(auth(token))
      .field('friend_name', 'Priya')
      .field('amount', '100')
      .field('due_date', dateOffset(3))
      .attach('receipt', Buffer.from('<script>alert(1)</script>'), {
        filename: 'evil.html',
        contentType: 'text/html',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JPEG, PNG or WebP/);
  });

  it('rejects a receipt larger than 5MB', async () => {
    const { token } = await login('+919111111111');
    const res = await request(app)
      .post('/loans')
      .set(auth(token))
      .field('friend_name', 'Priya')
      .field('amount', '100')
      .field('due_date', dateOffset(3))
      .attach('receipt', Buffer.alloc(5 * 1024 * 1024 + 1024), {
        filename: 'big.png',
        contentType: 'image/png',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/5MB/);
  });

  it.each([
    ['negative amount', { friend_name: 'A', amount: -5, due_date: '2030-01-01' }, 'amount'],
    ['zero amount', { friend_name: 'A', amount: 0, due_date: '2030-01-01' }, 'amount'],
    ['too many decimals', { friend_name: 'A', amount: 1.234, due_date: '2030-01-01' }, 'amount'],
    ['amount over the limit', { friend_name: 'A', amount: 10000001, due_date: '2030-01-01' }, 'amount'],
    ['non-numeric amount', { friend_name: 'A', amount: 'lots', due_date: '2030-01-01' }, 'amount'],
    ['badly formatted date', { friend_name: 'A', amount: 5, due_date: '01/02/2030' }, 'due_date'],
    ['impossible date', { friend_name: 'A', amount: 5, due_date: '2030-02-30' }, 'due_date'],
    ['empty name', { friend_name: '', amount: 5, due_date: '2030-01-01' }, 'friend_name'],
    ['whitespace-only name', { friend_name: '   ', amount: 5, due_date: '2030-01-01' }, 'friend_name'],
    ['name over 100 chars', { friend_name: 'x'.repeat(101), amount: 5, due_date: '2030-01-01' }, 'friend_name'],
  ])('returns 400 for %s', async (_label, body, field) => {
    const { token } = await login('+919111111111');
    const res = await request(app).post('/loans').set(auth(token)).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('reports every invalid field at once', async () => {
    const { token } = await login('+919111111111');
    const res = await request(app).post('/loans').set(auth(token)).send({ friend_name: '', amount: -1, due_date: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.details).toHaveLength(3);
  });
});

describe('GET /loans', () => {
  it('sorts unpaid first by due date, repaid last, and flags overdue in SQL', async () => {
    const { token, userId } = await login('+919111111111');
    // Insert directly so we can create past-due dates (the API would accept them too,
    // but this keeps the test independent of the create endpoint).
    await pool.query(
      `INSERT INTO loans (user_id, friend_name, amount, due_date, is_repaid, repaid_at) VALUES
        ($1, 'later',   10, CURRENT_DATE + 20, false, NULL),
        ($1, 'overdue', 20, CURRENT_DATE - 5,  false, NULL),
        ($1, 'soon',    30, CURRENT_DATE + 2,  false, NULL),
        ($1, 'paid',    40, CURRENT_DATE - 30, true,  now())`,
      [userId],
    );

    const res = await request(app).get('/loans').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.map((l: { friend_name: string }) => l.friend_name)).toEqual([
      'overdue',
      'soon',
      'later',
      'paid',
    ]);

    const byName = Object.fromEntries(res.body.map((l: { friend_name: string }) => [l.friend_name, l]));
    expect(byName.overdue.is_overdue).toBe(true);
    expect(byName.overdue.days_overdue).toBe(5);
    expect(byName.soon.is_overdue).toBe(false);
    expect(byName.paid.is_overdue).toBe(false); // repaid loans are never overdue
    expect(typeof byName.paid.amount).toBe('number');
  });

  it("only returns the logged-in user's loans", async () => {
    const alice = await login('+919111111111');
    const bob = await login('+919222222222');
    await createLoan(alice.token, { friend_name: 'For Alice', amount: 10, due_date: dateOffset(5) });

    const res = await request(app).get('/loans').set(auth(bob.token));
    expect(res.body).toEqual([]);
  });
});

describe('PATCH /loans/:id/repay', () => {
  it('marks a loan as repaid and rejects a second repay with 409', async () => {
    const { token } = await login('+919111111111');
    const loan = await createLoan(token, { friend_name: 'Rahul', amount: 100, due_date: dateOffset(5) });

    const first = await request(app).patch(`/loans/${loan.id}/repay`).set(auth(token));
    expect(first.status).toBe(200);
    expect(first.body.is_repaid).toBe(true);
    expect(first.body.repaid_at).not.toBeNull();

    const second = await request(app).patch(`/loans/${loan.id}/repay`).set(auth(token));
    expect(second.status).toBe(409);
    expect(second.body.error).toBeDefined();
  });

  it('returns 404 for a loan that does not exist', async () => {
    const { token } = await login('+919111111111');
    const res = await request(app).patch('/loans/00000000-0000-4000-8000-000000000000/repay').set(auth(token));
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) when repaying another user's loan, and leaves it untouched", async () => {
    const alice = await login('+919111111111');
    const bob = await login('+919222222222');
    const loan = await createLoan(alice.token, { friend_name: 'Rahul', amount: 100, due_date: dateOffset(5) });

    const res = await request(app).patch(`/loans/${loan.id}/repay`).set(auth(bob.token));
    expect(res.status).toBe(404);

    const row = await pool.query('SELECT is_repaid FROM loans WHERE id = $1', [loan.id]);
    expect(row.rows[0].is_repaid).toBe(false);
  });

  it('returns 400 for an invalid UUID', async () => {
    const { token } = await login('+919111111111');
    const res = await request(app).patch('/loans/not-a-uuid/repay').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

describe('GET /loans/summary', () => {
  it('returns zeros (not null) when the user has no loans', async () => {
    const { token } = await login('+919111111111');
    const res = await request(app).get('/loans/summary').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      total_lent: 0,
      total_repaid: 0,
      outstanding: 0,
      overdue_amount: 0,
      loan_count: 0,
      overdue_count: 0,
    });
  });

  it('computes correct totals for a mix of repaid, pending and overdue loans', async () => {
    const { token, userId } = await login('+919111111111');
    const other = await login('+919222222222');

    await pool.query(
      `INSERT INTO loans (user_id, friend_name, amount, due_date, is_repaid, repaid_at) VALUES
        ($1, 'repaid',          1000.25, CURRENT_DATE - 40, true,  now()),
        ($1, 'pending',          500.50, CURRENT_DATE + 10, false, NULL),
        ($1, 'overdue 1',        200.00, CURRENT_DATE - 1,  false, NULL),
        ($1, 'overdue 2',        300.10, CURRENT_DATE - 15, false, NULL),
        ($1, 'due today',         50.00, CURRENT_DATE,      false, NULL),
        ($2, 'someone elses',   9999.00, CURRENT_DATE - 9,  false, NULL)`,
      [userId, other.userId],
    );

    const res = await request(app).get('/loans/summary').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      total_lent: 2050.85, // 1000.25 + 500.50 + 200.00 + 300.10 + 50.00
      total_repaid: 1000.25,
      outstanding: 1050.6, // 500.50 + 200.00 + 300.10 + 50.00
      overdue_amount: 500.1, // 200.00 + 300.10 ("due today" is NOT overdue yet)
      loan_count: 5,
      overdue_count: 2,
    });
  });

  it('updates after a loan is repaid', async () => {
    const { token, userId } = await login('+919111111111');
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO loans (user_id, friend_name, amount, due_date) VALUES ($1, 'x', 100, CURRENT_DATE - 3) RETURNING id`,
      [userId],
    );

    const before = await request(app).get('/loans/summary').set(auth(token));
    expect(before.body.overdue_amount).toBe(100);

    await request(app).patch(`/loans/${inserted.rows[0].id}/repay`).set(auth(token)).expect(200);

    const after = await request(app).get('/loans/summary').set(auth(token));
    expect(after.body).toMatchObject({ total_repaid: 100, outstanding: 0, overdue_amount: 0, overdue_count: 0 });
  });
});
