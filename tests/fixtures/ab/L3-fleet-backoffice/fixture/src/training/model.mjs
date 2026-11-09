// Training entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 90;

export function makeTrainingEntry(id, input, at) {
  if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > MAX_UNITS) throw new RangeError('seats must be a whole number from 1 to ' + MAX_UNITS);
  if (typeof input.rate !== 'number' || !(input.rate > 0)) throw new RangeError('rate must be a positive number of dollars');
  return { id, seats: input.seats, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isTrainingOpen = (entry) => !entry.voided;
export const isTrainingLarge = (entry) => entry.seats > MAX_UNITS / 2;

export function describeTraining(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.seats} seats at ${entry.rate} (${state})`;
}
