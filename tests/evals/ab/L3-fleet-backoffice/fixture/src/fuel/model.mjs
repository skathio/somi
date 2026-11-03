// Fuel entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 500;

export function makeFuelEntry(id, input, at) {
  if (!Number.isInteger(input.litres) || input.litres < 1 || input.litres > MAX_UNITS) throw new RangeError('litres must be a whole number from 1 to ' + MAX_UNITS);
  if (typeof input.rate !== 'number' || !(input.rate > 0)) throw new RangeError('rate must be a positive number of dollars');
  return { id, litres: input.litres, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isFuelOpen = (entry) => !entry.voided;
export const isFuelLarge = (entry) => entry.litres > MAX_UNITS / 2;

export function describeFuel(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.litres} litres at ${entry.rate} (${state})`;
}
