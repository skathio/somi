// Parking entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 72;

export function makeParkingEntry(id, input, at) {
  if (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > MAX_UNITS) throw new RangeError('hours must be a whole number from 1 to ' + MAX_UNITS);
  if (typeof input.rate !== 'number' || !(input.rate > 0)) throw new RangeError('rate must be a positive number of dollars');
  return { id, hours: input.hours, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isParkingOpen = (entry) => !entry.voided;
export const isParkingLarge = (entry) => entry.hours > MAX_UNITS / 2;

export function describeParking(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.hours} hours at ${entry.rate} (${state})`;
}
