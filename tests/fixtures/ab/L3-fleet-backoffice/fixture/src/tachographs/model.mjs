// Tachographs entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 180;

export function makeTachographsEntry(id, input, at) {
  for (const [field, ok] of [['units', Number.isInteger(input.units) && input.units >= 1 && input.units <= MAX_UNITS], ['rate', typeof input.rate === 'number' && input.rate > 0]]) {
    if (!ok) throw new RangeError(field + ' is out of range');
  }
  return { id, units: input.units, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isTachographsOpen = (entry) => !entry.voided;
export const isTachographsLarge = (entry) => entry.units > MAX_UNITS / 2;

export function describeTachographs(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.units} units at ${entry.rate} (${state})`;
}
