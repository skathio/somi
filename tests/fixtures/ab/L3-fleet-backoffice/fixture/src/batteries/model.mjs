// Batteries entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 70;

export function makeBatteriesEntry(id, input, at) {
  if (!Number.isInteger(input.packs) || input.packs < 1 || input.packs > MAX_UNITS) throw new RangeError('packs must be a whole number from 1 to ' + MAX_UNITS);
  if (typeof input.rate !== 'number' || !(input.rate > 0)) throw new RangeError('rate must be a positive number of dollars');
  return { id, packs: input.packs, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isBatteriesOpen = (entry) => !entry.voided;
export const isBatteriesLarge = (entry) => entry.packs > MAX_UNITS / 2;

export function describeBatteries(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.packs} packs at ${entry.rate} (${state})`;
}
