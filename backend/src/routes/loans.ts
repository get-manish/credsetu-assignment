import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { config } from '../config';
import { query } from '../db';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { HttpError, Loan, LoanRow, Summary } from '../types';

export const loansRouter = Router();

// Every loan route needs a logged-in user.
loansRouter.use(requireAuth);

// ---------- helpers ----------

// The columns we return for a loan. is_overdue / days_overdue are computed IN SQL so the
// database (one clock, one timezone) is the single source of truth.
// to_char keeps due_date as a plain 'YYYY-MM-DD' string.
const LOAN_COLUMNS = `
  id, friend_name, amount,
  to_char(due_date, 'YYYY-MM-DD') AS due_date,
  is_repaid, repaid_at, receipt_url, created_at,
  (NOT is_repaid AND due_date < CURRENT_DATE) AS is_overdue,
  CASE WHEN NOT is_repaid AND due_date < CURRENT_DATE
       THEN (CURRENT_DATE - due_date) ELSE 0 END AS days_overdue`;

// NUMERIC comes back from pg as a string (e.g. "1500.50"); the API promises numbers.
export function mapLoan(row: LoanRow): Loan {
  return {
    id: row.id,
    friend_name: row.friend_name,
    amount: Number(row.amount),
    due_date: row.due_date,
    is_repaid: row.is_repaid,
    repaid_at: row.repaid_at ? new Date(row.repaid_at).toISOString() : null,
    receipt_url: row.receipt_url,
    created_at: new Date(row.created_at).toISOString(),
    is_overdue: row.is_overdue,
    days_overdue: Number(row.days_overdue),
  };
}

// ---------- validation schemas ----------

// multipart/form-data sends every field as a string, JSON may send a number.
// So we accept both, then check the text form: digits with at most 2 decimals.
const amountSchema = z
  .union([z.string(), z.number()], { required_error: 'Amount is required', invalid_type_error: 'Amount must be a number' })
  .transform((v) => String(v).trim())
  .pipe(
    z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a positive number with at most 2 decimal places')
      .refine((v) => Number(v) > 0, 'Amount must be greater than 0')
      .refine((v) => Number(v) <= 10_000_000, 'Amount must be at most 10,000,000'),
  )
  .transform(Number);

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

// True only for real calendar days. JS silently rolls 2025-02-30 over to March 2, so we
// build the date and check that every part survived the round trip. Never throws.
function isRealDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Must look like YYYY-MM-DD AND be a real calendar day (rejects 2025-02-30 and 2025-13-01).
// The refine is skipped for wrongly formatted text so the user sees one clear message.
const dueDateSchema = z
  .string({ required_error: 'Due date is required' })
  .regex(DATE_FORMAT, 'Due date must be in YYYY-MM-DD format')
  .refine((v) => !DATE_FORMAT.test(v) || isRealDate(v), 'Due date is not a valid date');

const createLoanSchema = z.object({
  friend_name: z
    .string({ required_error: 'Friend name is required' })
    .trim()
    .min(1, 'Friend name is required')
    .max(100, 'Friend name must be at most 100 characters'),
  amount: amountSchema,
  due_date: dueDateSchema,
});

const idParamSchema = z.object({ id: z.string().uuid('Loan id must be a valid UUID') });

// ---------- receipt upload (multer) ----------

// Map the declared MIME type to a file extension. We pick the extension ourselves
// instead of trusting the client's filename (which could be "evil.html").
// A Map (not a plain object) so odd values like "constructor" can't match by accident.
const ALLOWED_TYPES = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

fs.mkdirSync(config.uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadsDir,
    // Random name: no collisions, and nobody can guess another user's receipt URL.
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED_TYPES.get(file.mimetype)}`),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) return cb(null, true);
    cb(new HttpError(400, 'Receipt must be a JPEG, PNG or WebP image'));
  },
});

// ---------- routes ----------

// GET /loans/summary  (declared before any "/:id" routes so "summary" is never read as an id)
// One aggregate query. FILTER limits each SUM/COUNT to matching rows;
// COALESCE turns "no rows" (NULL) into 0.
loansRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const result = await query<Record<keyof Summary, string>>(
      `SELECT
         COALESCE(SUM(amount), 0)                                                     AS total_lent,
         COALESCE(SUM(amount) FILTER (WHERE is_repaid), 0)                            AS total_repaid,
         COALESCE(SUM(amount) FILTER (WHERE NOT is_repaid), 0)                        AS outstanding,
         COALESCE(SUM(amount) FILTER (WHERE NOT is_repaid AND due_date < CURRENT_DATE), 0) AS overdue_amount,
         COUNT(*)                                                                     AS loan_count,
         COUNT(*) FILTER (WHERE NOT is_repaid AND due_date < CURRENT_DATE)            AS overdue_count
       FROM loans
       WHERE user_id = $1`,
      [req.user!.id],
    );
    const r = result.rows[0];
    const summary: Summary = {
      total_lent: Number(r.total_lent),
      total_repaid: Number(r.total_repaid),
      outstanding: Number(r.outstanding),
      overdue_amount: Number(r.overdue_amount),
      loan_count: Number(r.loan_count),
      overdue_count: Number(r.overdue_count),
    };
    res.json(summary);
  }),
);

// GET /loans: unpaid first, then soonest due date first.
loansRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await query<LoanRow>(
      `SELECT ${LOAN_COLUMNS} FROM loans
       WHERE user_id = $1
       ORDER BY is_repaid ASC, due_date ASC, created_at ASC`,
      [req.user!.id],
    );
    res.json(result.rows.map(mapLoan));
  }),
);

// POST /loans: JSON or multipart/form-data. upload.single() only touches multipart requests;
// for JSON requests it simply calls next(), and express.json() has already filled req.body.
loansRouter.post(
  '/',
  upload.single('receipt'),
  validate(createLoanSchema),
  asyncHandler(async (req, res) => {
    const { friend_name, amount, due_date } = req.body as z.infer<typeof createLoanSchema>;
    const receiptUrl = req.file ? `/uploads/${req.file.filename}` : null;

    try {
      const result = await query<LoanRow>(
        `INSERT INTO loans (user_id, friend_name, amount, due_date, receipt_url)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${LOAN_COLUMNS}`,
        [req.user!.id, friend_name, amount, due_date, receiptUrl],
      );
      res.status(201).json(mapLoan(result.rows[0]));
    } catch (err) {
      // Insert failed: don't leave the uploaded file lying around.
      if (req.file) fs.unlink(path.join(config.uploadsDir, req.file.filename), () => undefined);
      throw err;
    }
  }),
);

// PATCH /loans/:id/repay
loansRouter.patch(
  '/:id/repay',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user!.id;

    // One atomic UPDATE: it only matches rows that belong to this user AND are not yet repaid,
    // so two simultaneous requests can't both "win".
    const updated = await query<LoanRow>(
      `UPDATE loans SET is_repaid = true, repaid_at = now()
       WHERE id = $1 AND user_id = $2 AND is_repaid = false
       RETURNING ${LOAN_COLUMNS}`,
      [id, userId],
    );
    if (updated.rows[0]) {
      res.json(mapLoan(updated.rows[0]));
      return;
    }

    // Nothing updated: either it isn't theirs / doesn't exist (404), or it was already repaid (409).
    // Another user's loan gets the same 404 as a missing one, so ids can't be probed.
    const exists = await query(`SELECT 1 FROM loans WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (exists.rowCount === 0) throw new HttpError(404, 'Loan not found');
    throw new HttpError(409, 'Loan is already marked as repaid');
  }),
);
