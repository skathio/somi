import { LedgerError } from './errors.mjs';

// The largest amount of cents a balance or a transfer can hold and still be represented exactly.
export const MAX_CENTS = Number.MAX_SAFE_INTEGER;

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
