// Ferries entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 150;

export function makeFerriesEntry(id, input, at) {
  for (const [field, ok] of [['sailings', Number.isInteger(input.sailings) && input.sailings >= 1 && input.sailings <= MAX_UNITS], ['rate', typeof input.rate === 'number' && input.rate > 0]]) {
    if (!ok) throw new RangeError(field + ' is out of range');
  }
  return { id, sailings: input.sailings, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isFerriesOpen = (entry) => !entry.voided;
export const isFerriesLarge = (entry) => entry.sailings > MAX_UNITS / 2;

export function describeFerries(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.sailings} sailings at ${entry.rate} (${state})`;
}
