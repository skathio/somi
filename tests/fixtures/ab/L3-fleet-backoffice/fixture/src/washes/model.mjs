// Washes entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 200;

export function makeWashesEntry(id, input, at) {
  for (const [field, ok] of [['washes', Number.isInteger(input.washes) && input.washes >= 1 && input.washes <= MAX_UNITS], ['rate', typeof input.rate === 'number' && input.rate > 0]]) {
    if (!ok) throw new RangeError(field + ' is out of range');
  }
  return { id, washes: input.washes, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isWashesOpen = (entry) => !entry.voided;
export const isWashesLarge = (entry) => entry.washes > MAX_UNITS / 2;

export function describeWashes(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.washes} washes at ${entry.rate} (${state})`;
}
