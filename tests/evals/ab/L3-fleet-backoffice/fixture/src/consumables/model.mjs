// Consumables entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 150;

export function makeConsumablesEntry(id, input, at) {
  if (!Number.isInteger(input.boxes) || input.boxes < 1 || input.boxes > MAX_UNITS) throw new RangeError('boxes must be a whole number from 1 to ' + MAX_UNITS);
  if (typeof input.rate !== 'number' || !(input.rate > 0)) throw new RangeError('rate must be a positive number of dollars');
  return { id, boxes: input.boxes, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isConsumablesOpen = (entry) => !entry.voided;
export const isConsumablesLarge = (entry) => entry.boxes > MAX_UNITS / 2;

export function describeConsumables(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.boxes} boxes at ${entry.rate} (${state})`;
}
