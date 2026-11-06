// Rentals entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 90;

export function makeRentalsEntry(id, input, at) {
  const problems = [];
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_UNITS) problems.push('days');
  if (typeof input.rate !== 'number' || !(input.rate > 0)) problems.push('rate');
  if (problems.length > 0) throw new RangeError('invalid ' + problems.join(' and '));
  return { id, days: input.days, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isRentalsOpen = (entry) => !entry.voided;
export const isRentalsLarge = (entry) => entry.days > MAX_UNITS / 2;

export function describeRentals(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.days} days at ${entry.rate} (${state})`;
}
