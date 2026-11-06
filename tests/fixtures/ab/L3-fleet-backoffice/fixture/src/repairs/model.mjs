// Repairs entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 160;

export function makeRepairsEntry(id, input, at) {
  const problems = [];
  if (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > MAX_UNITS) problems.push('hours');
  if (typeof input.rate !== 'number' || !(input.rate > 0)) problems.push('rate');
  if (problems.length > 0) throw new RangeError('invalid ' + problems.join(' and '));
  return { id, hours: input.hours, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isRepairsOpen = (entry) => !entry.voided;
export const isRepairsLarge = (entry) => entry.hours > MAX_UNITS / 2;

export function describeRepairs(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.hours} hours at ${entry.rate} (${state})`;
}
