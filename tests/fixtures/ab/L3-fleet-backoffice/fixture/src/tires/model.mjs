// Tires entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 40;

export function makeTiresEntry(id, input, at) {
  const problems = [];
  if (!Number.isInteger(input.tires) || input.tires < 1 || input.tires > MAX_UNITS) problems.push('tires');
  if (typeof input.rate !== 'number' || !(input.rate > 0)) problems.push('rate');
  if (problems.length > 0) throw new RangeError('invalid ' + problems.join(' and '));
  return { id, tires: input.tires, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isTiresOpen = (entry) => !entry.voided;
export const isTiresLarge = (entry) => entry.tires > MAX_UNITS / 2;

export function describeTires(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.tires} tires at ${entry.rate} (${state})`;
}
