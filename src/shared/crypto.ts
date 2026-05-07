import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashSecret(value: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(value, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifySecret(value: string, encoded: string | null | undefined) {
  if (!encoded) return false;
  const [salt, hash] = encoded.split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(value, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
