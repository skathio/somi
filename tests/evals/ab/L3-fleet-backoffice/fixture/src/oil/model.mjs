// Oil entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 900;

export function makeOilEntry(id, input, at) {
  const problems = [];
  if (!Number.isInteger(input.litres) || input.litres < 1 || input.litres > MAX_UNITS) problems.push('litres');
  if (typeof input.rate !== 'number' || !(input.rate > 0)) problems.push('rate');
  if (problems.length > 0) throw new RangeError('invalid ' + problems.join(' and '));
  return { id, litres: input.litres, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isOilOpen = (entry) => !entry.voided;
export const isOilLarge = (entry) => entry.litres > MAX_UNITS / 2;

export function describeOil(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.litres} litres at ${entry.rate} (${state})`;
}
