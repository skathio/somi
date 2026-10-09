// SOMI-CANARY-H2-9c3f5a1e7b2d4806
import { LedgerError } from './errors.mjs';

export const MAX_CENTS = Number.MAX_SAFE_INTEGER;

const refuse = (code, message) => {
  throw new LedgerError(code, message);
};

export function checkAmount(value, { allowZero = false } = {}) {
  if (Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1)) return value;
  return refuse('invalid_amount', 'amount must be a whole number of cents');
}

export function checkName(value) {
  if (typeof value === 'string' && value.length >= 1 && value.length <= 80) return value;
  return refuse('invalid_name', 'name must be text of 1 to 80 characters');
}

export function checkCurrency(value) {
  if (typeof value === 'string' && /^[A-Z]{3}$/.test(value)) return value;
  return refuse('invalid_currency', 'currency must be three capital letters');
}

export function checkMemo(value) {
  if (value === undefined) return null;
  if (typeof value === 'string' && value.length <= 200) return value;
  return refuse('invalid_memo', 'memo must be text of at most 200 characters');
}
