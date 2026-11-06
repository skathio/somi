// Bridges entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 400;

export function makeBridgesEntry(id, input, at) {
  const problems = [];
  if (!Number.isInteger(input.crossings) || input.crossings < 1 || input.crossings > MAX_UNITS) problems.push('crossings');
  if (typeof input.rate !== 'number' || !(input.rate > 0)) problems.push('rate');
  if (problems.length > 0) throw new RangeError('invalid ' + problems.join(' and '));
  return { id, crossings: input.crossings, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isBridgesOpen = (entry) => !entry.voided;
export const isBridgesLarge = (entry) => entry.crossings > MAX_UNITS / 2;

export function describeBridges(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.crossings} crossings at ${entry.rate} (${state})`;
}
