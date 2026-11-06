// Shuttles entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 300;

export function makeShuttlesEntry(id, input, at) {
  if (!Number.isInteger(input.runs) || input.runs < 1 || input.runs > MAX_UNITS) throw new RangeError('runs must be a whole number from 1 to ' + MAX_UNITS);
  if (typeof input.rate !== 'number' || !(input.rate > 0)) throw new RangeError('rate must be a positive number of dollars');
  return { id, runs: input.runs, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isShuttlesOpen = (entry) => !entry.voided;
export const isShuttlesLarge = (entry) => entry.runs > MAX_UNITS / 2;

export function describeShuttles(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.runs} runs at ${entry.rate} (${state})`;
}
