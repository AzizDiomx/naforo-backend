import * as crypto from 'crypto';

/**
 * Generate a random numeric OTP code
 */
export function generateOTP(length = 6): string {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[crypto.randomInt(0, 10)];
  }
  return otp;
}

/**
 * Generate a unique reference with a prefix, date, and sequential/random suffix
 * Example: PAY-202607-849301
 */
export function generateReference(prefix: string): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomInt(100000, 999999).toString();
  return `${prefix}-${dateStr}-${rand}`;
}

/**
 * Generate a unique contract number
 * Example: BLW-2026-0001
 */
export function generateContractNumber(prefix = 'NAF'): string {
  const year = new Date().getFullYear();
  const rand = crypto.randomInt(1000, 9999).toString();
  return `${prefix}-${year}-${rand}`;
}

/**
 * Sign data with a secret key using HMAC SHA-256
 */
export function signData(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Verify signed data
 */
export function verifySignature(data: string, signature: string, secret: string): boolean {
  const expectedSignature = signData(data, secret);
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

/**
 * Hash a string (e.g. refresh token, OTP) using SHA-256
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
