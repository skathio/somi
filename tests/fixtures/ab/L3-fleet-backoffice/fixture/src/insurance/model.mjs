// Insurance entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 300;

export function makeInsuranceEntry(id, input, at) {
  if (!Number.isInteger(input.vehicles) || input.vehicles < 1 || input.vehicles > MAX_UNITS) throw new RangeError('vehicles must be a whole number from 1 to ' + MAX_UNITS);
  if (typeof input.rate !== 'number' || !(input.rate > 0)) throw new RangeError('rate must be a positive number of dollars');
  return { id, vehicles: input.vehicles, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isInsuranceOpen = (entry) => !entry.voided;
export const isInsuranceLarge = (entry) => entry.vehicles > MAX_UNITS / 2;

export function describeInsurance(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.vehicles} vehicles at ${entry.rate} (${state})`;
}
