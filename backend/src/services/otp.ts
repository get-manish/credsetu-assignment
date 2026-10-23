import { createHash, randomInt, timingSafeEqual } from 'crypto';

// Random 6-digit code. randomInt uses a cryptographically secure generator
// (Math.random is predictable and must not be used for security codes).
export function generateOtp(): string {
  return String(randomInt(100000, 1000000));
}

// We never store the OTP itself, only its SHA-256 hash. If the table leaks,
// the codes can't simply be read. The phone number is mixed in so the same
// code for two phones produces two different hashes.
export function hashOtp(phone: string, code: string): string {
  return createHash('sha256').update(`${phone}:${code}`).digest('hex');
}

// Constant-time comparison so response timing can't leak how many characters matched.
export function otpMatches(phone: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(hashOtp(phone, code), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// "Sending" the OTP is just printing it. A real app would call an SMS provider here.
export function deliverOtp(phone: string, code: string): void {
  console.log(`[MOCK OTP] ${phone} -> ${code}`);
}
