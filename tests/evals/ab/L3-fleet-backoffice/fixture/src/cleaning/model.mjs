// Cleaning entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 80;

export function makeCleaningEntry(id, input, at) {
  const problems = [];
  if (!Number.isInteger(input.cabins) || input.cabins < 1 || input.cabins > MAX_UNITS) problems.push('cabins');
  if (typeof input.rate !== 'number' || !(input.rate > 0)) problems.push('rate');
  if (problems.length > 0) throw new RangeError('invalid ' + problems.join(' and '));
  return { id, cabins: input.cabins, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isCleaningOpen = (entry) => !entry.voided;
export const isCleaningLarge = (entry) => entry.cabins > MAX_UNITS / 2;

export function describeCleaning(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.cabins} cabins at ${entry.rate} (${state})`;
}
