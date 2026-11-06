// Trips entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 2000;

export function makeTripsEntry(id, input, at) {
  const problems = [];
  if (!Number.isInteger(input.km) || input.km < 1 || input.km > MAX_UNITS) problems.push('km');
  if (typeof input.rate !== 'number' || !(input.rate > 0)) problems.push('rate');
  if (problems.length > 0) throw new RangeError('invalid ' + problems.join(' and '));
  return { id, km: input.km, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isTripsOpen = (entry) => !entry.voided;
export const isTripsLarge = (entry) => entry.km > MAX_UNITS / 2;

export function describeTrips(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.km} km at ${entry.rate} (${state})`;
}
