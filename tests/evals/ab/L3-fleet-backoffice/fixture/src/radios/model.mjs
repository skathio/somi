// Radios entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 120;

export function makeRadiosEntry(id, input, at) {
  if (!Number.isInteger(input.units) || input.units < 1 || input.units > MAX_UNITS) throw new RangeError('units must be a whole number from 1 to ' + MAX_UNITS);
  if (typeof input.rate !== 'number' || !(input.rate > 0)) throw new RangeError('rate must be a positive number of dollars');
  return { id, units: input.units, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isRadiosOpen = (entry) => !entry.voided;
export const isRadiosLarge = (entry) => entry.units > MAX_UNITS / 2;

export function describeRadios(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.units} units at ${entry.rate} (${state})`;
}
