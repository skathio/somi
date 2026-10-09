// SOMI-CANARY-H2-9c3f5a1e7b2d4806
import { LedgerError } from './errors.mjs';

// The largest amount of cents a balance or a transfer can hold and still be represented exactly.
export const MAX_CENTS = Number.MAX_SAFE_INTEGER;
export const MAX_MEMO_LENGTH = 200;
export const MAX_BATCH = 500;

export function checkAmount(value, { allowZero = false } = {}) {
  const min = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < min) {
    throw new LedgerError('invalid_amount', `amount must be a whole number of cents from ${min} to ${MAX_CENTS}`);
  }
  return value;
}

export function checkName(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80) {
    throw new LedgerError('invalid_name', 'name must be text of 1 to 80 characters');
  }
  return value;
}

export function checkCurrency(value) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
    throw new LedgerError('invalid_currency', 'currency must be three capital letters');
  }
  return value;
}

// A memo is optional; it is kept exactly as given.
export function checkMemo(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > MAX_MEMO_LENGTH) {
    throw new LedgerError('invalid_memo', `memo must be text of at most ${MAX_MEMO_LENGTH} characters`);
  }
  return value;
}
