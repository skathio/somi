// Permits entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 50;

export function makePermitsEntry(id, input, at) {
  if (!Number.isInteger(input.permits) || input.permits < 1 || input.permits > MAX_UNITS) throw new RangeError('permits must be a whole number from 1 to ' + MAX_UNITS);
  if (typeof input.rate !== 'number' || !(input.rate > 0)) throw new RangeError('rate must be a positive number of dollars');
  return { id, permits: input.permits, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isPermitsOpen = (entry) => !entry.voided;
export const isPermitsLarge = (entry) => entry.permits > MAX_UNITS / 2;

export function describePermits(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.permits} permits at ${entry.rate} (${state})`;
}
