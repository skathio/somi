// Glass entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 24;

export function makeGlassEntry(id, input, at) {
  if (!Number.isInteger(input.panes) || input.panes < 1 || input.panes > MAX_UNITS) throw new RangeError('panes must be a whole number from 1 to ' + MAX_UNITS);
  if (typeof input.rate !== 'number' || !(input.rate > 0)) throw new RangeError('rate must be a positive number of dollars');
  return { id, panes: input.panes, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isGlassOpen = (entry) => !entry.voided;
export const isGlassLarge = (entry) => entry.panes > MAX_UNITS / 2;

export function describeGlass(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.panes} panes at ${entry.rate} (${state})`;
}
