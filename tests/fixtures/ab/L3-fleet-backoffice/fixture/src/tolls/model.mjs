// Tolls entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 60;

export function makeTollsEntry(id, input, at) {
  for (const [field, ok] of [['crossings', Number.isInteger(input.crossings) && input.crossings >= 1 && input.crossings <= MAX_UNITS], ['rate', typeof input.rate === 'number' && input.rate > 0]]) {
    if (!ok) throw new RangeError(field + ' is out of range');
  }
  return { id, crossings: input.crossings, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isTollsOpen = (entry) => !entry.voided;
export const isTollsLarge = (entry) => entry.crossings > MAX_UNITS / 2;

export function describeTolls(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.crossings} crossings at ${entry.rate} (${state})`;
}
