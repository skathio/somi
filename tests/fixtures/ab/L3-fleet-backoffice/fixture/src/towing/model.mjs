// Towing entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 800;

export function makeTowingEntry(id, input, at) {
  for (const [field, ok] of [['km', Number.isInteger(input.km) && input.km >= 1 && input.km <= MAX_UNITS], ['rate', typeof input.rate === 'number' && input.rate > 0]]) {
    if (!ok) throw new RangeError(field + ' is out of range');
  }
  return { id, km: input.km, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isTowingOpen = (entry) => !entry.voided;
export const isTowingLarge = (entry) => entry.km > MAX_UNITS / 2;

export function describeTowing(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.km} km at ${entry.rate} (${state})`;
}
