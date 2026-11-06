// Licences entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 300;

export function makeLicencesEntry(id, input, at) {
  if (!Number.isInteger(input.drivers) || input.drivers < 1 || input.drivers > MAX_UNITS) throw new RangeError('drivers must be a whole number from 1 to ' + MAX_UNITS);
  if (typeof input.rate !== 'number' || !(input.rate > 0)) throw new RangeError('rate must be a positive number of dollars');
  return { id, drivers: input.drivers, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isLicencesOpen = (entry) => !entry.voided;
export const isLicencesLarge = (entry) => entry.drivers > MAX_UNITS / 2;

export function describeLicences(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.drivers} drivers at ${entry.rate} (${state})`;
}
