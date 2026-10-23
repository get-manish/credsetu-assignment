import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { query } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { deliverOtp, generateOtp, hashOtp, otpMatches } from '../services/otp';
import { HttpError } from '../types';

export const authRouter = Router();

// E.164-like: optional "+", then 10-15 digits.
const phoneSchema = z
  .string({ required_error: 'Phone is required' })
  .trim()
  .regex(/^\+?[0-9]{10,15}$/, 'Phone must be 10-15 digits, optionally starting with +');

const requestOtpSchema = z.object({ phone: phoneSchema });

const verifyOtpSchema = z.object({
  phone: phoneSchema,
  otp: z.string({ required_error: 'OTP is required' }).trim().regex(/^[0-9]{6}$/, 'OTP must be 6 digits'),
});

// POST /auth/request-otp
authRouter.post(
  '/request-otp',
  validate(requestOtpSchema),
  asyncHandler(async (req, res) => {
    const { phone } = req.body as z.infer<typeof requestOtpSchema>;

    // Rate limit: count OTPs already created for this phone in the last 10 minutes.
    // Using the table itself means no extra infrastructure (like Redis) is needed.
    const recent = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM otps
       WHERE phone = $1 AND created_at > now() - make_interval(mins => $2::int)`,
      [phone, config.otpRequestWindowMinutes],
    );
    if (Number(recent.rows[0].count) >= config.otpRequestLimit) {
      throw new HttpError(429, 'Too many OTP requests. Please try again in a few minutes.');
    }

    const code = generateOtp();
    // expires_at is computed by the database so every timestamp uses the same clock.
    await query(
      `INSERT INTO otps (phone, code_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(mins => $3::int))`,
      [phone, hashOtp(phone, code), config.otpTtlMinutes],
    );

    deliverOtp(phone, code); // mock SMS: prints to the server console
    // The OTP is deliberately NOT in the response.
    res.json({ message: 'OTP sent' });
  }),
);

interface OtpRow {
  id: number;
  code_hash: string;
  attempts: number;
}

// POST /auth/verify-otp
authRouter.post(
  '/verify-otp',
  validate(verifyOtpSchema),
  asyncHandler(async (req, res) => {
    const { phone, otp } = req.body as z.infer<typeof verifyOtpSchema>;

    // Only the newest unused, unexpired OTP counts. Older ones are ignored.
    const latest = await query<OtpRow>(
      `SELECT id, code_hash, attempts FROM otps
       WHERE phone = $1 AND used = false AND expires_at > now()
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [phone],
    );
    const row = latest.rows[0];
    if (!row) throw new HttpError(401, 'OTP expired or not found. Please request a new one.');
    if (row.attempts >= config.otpMaxAttempts) {
      throw new HttpError(401, 'Too many incorrect attempts. Please request a new OTP.');
    }

    // Count the attempt BEFORE checking the code. Doing it first (and atomically, with the
    // attempts guard) means parallel guesses cannot sneak past the limit.
    const counted = await query(
      `UPDATE otps SET attempts = attempts + 1
       WHERE id = $1 AND attempts < $2 AND used = false
       RETURNING id`,
      [row.id, config.otpMaxAttempts],
    );
    if (counted.rowCount === 0) {
      throw new HttpError(401, 'Too many incorrect attempts. Please request a new OTP.');
    }

    if (!otpMatches(phone, otp, row.code_hash)) {
      throw new HttpError(401, 'Incorrect OTP');
    }

    // `AND used = false` makes this a one-shot: if two requests race with the right code,
    // only one wins.
    const consumed = await query(`UPDATE otps SET used = true WHERE id = $1 AND used = false RETURNING id`, [
      row.id,
    ]);
    if (consumed.rowCount === 0) throw new HttpError(401, 'OTP already used. Please request a new one.');

    // Upsert: create the user on first login, otherwise return the existing one.
    // The no-op UPDATE is what makes RETURNING work in the "already exists" case.
    const userResult = await query<{ id: string; phone: string }>(
      `INSERT INTO users (phone) VALUES ($1)
       ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
       RETURNING id, phone`,
      [phone],
    );
    const user = userResult.rows[0];

    const token = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, phone: user.phone } });
  }),
);
