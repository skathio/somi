// Storage entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 400;

export function makeStorageEntry(id, input, at) {
  const problems = [];
  if (!Number.isInteger(input.pallets) || input.pallets < 1 || input.pallets > MAX_UNITS) problems.push('pallets');
  if (typeof input.rate !== 'number' || !(input.rate > 0)) problems.push('rate');
  if (problems.length > 0) throw new RangeError('invalid ' + problems.join(' and '));
  return { id, pallets: input.pallets, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isStorageOpen = (entry) => !entry.voided;
export const isStorageLarge = (entry) => entry.pallets > MAX_UNITS / 2;

export function describeStorage(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.pallets} pallets at ${entry.rate} (${state})`;
}
