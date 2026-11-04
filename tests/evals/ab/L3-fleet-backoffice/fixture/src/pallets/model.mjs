// Pallets entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 800;

export function makePalletsEntry(id, input, at) {
  if (!Number.isInteger(input.pallets) || input.pallets < 1 || input.pallets > MAX_UNITS) throw new RangeError('pallets must be a whole number from 1 to ' + MAX_UNITS);
  if (typeof input.rate !== 'number' || !(input.rate > 0)) throw new RangeError('rate must be a positive number of dollars');
  return { id, pallets: input.pallets, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isPalletsOpen = (entry) => !entry.voided;
export const isPalletsLarge = (entry) => entry.pallets > MAX_UNITS / 2;

export function describePallets(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.pallets} pallets at ${entry.rate} (${state})`;
}
