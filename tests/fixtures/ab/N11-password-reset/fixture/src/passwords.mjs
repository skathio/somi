import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.mjs';

export function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 12) throw new HttpError(400, 'weak_password', 'at least 12 characters');
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 32).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, 'hex'), 32), Buffer.from(hash, 'hex'));
}
