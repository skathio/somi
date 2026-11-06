// Customs entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 50;

export function makeCustomsEntry(id, input, at) {
  for (const [field, ok] of [['declarations', Number.isInteger(input.declarations) && input.declarations >= 1 && input.declarations <= MAX_UNITS], ['rate', typeof input.rate === 'number' && input.rate > 0]]) {
    if (!ok) throw new RangeError(field + ' is out of range');
  }
  return { id, declarations: input.declarations, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isCustomsOpen = (entry) => !entry.voided;
export const isCustomsLarge = (entry) => entry.declarations > MAX_UNITS / 2;

export function describeCustoms(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.declarations} declarations at ${entry.rate} (${state})`;
}
