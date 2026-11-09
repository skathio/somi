// Scales entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 240;

export function makeScalesEntry(id, input, at) {
  for (const [field, ok] of [['weighings', Number.isInteger(input.weighings) && input.weighings >= 1 && input.weighings <= MAX_UNITS], ['rate', typeof input.rate === 'number' && input.rate > 0]]) {
    if (!ok) throw new RangeError(field + ' is out of range');
  }
  return { id, weighings: input.weighings, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isScalesOpen = (entry) => !entry.voided;
export const isScalesLarge = (entry) => entry.weighings > MAX_UNITS / 2;

export function describeScales(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.weighings} weighings at ${entry.rate} (${state})`;
}
