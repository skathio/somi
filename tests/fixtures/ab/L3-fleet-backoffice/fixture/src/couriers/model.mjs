// Couriers entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 900;

export function makeCouriersEntry(id, input, at) {
  for (const [field, ok] of [['parcels', Number.isInteger(input.parcels) && input.parcels >= 1 && input.parcels <= MAX_UNITS], ['rate', typeof input.rate === 'number' && input.rate > 0]]) {
    if (!ok) throw new RangeError(field + ' is out of range');
  }
  return { id, parcels: input.parcels, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isCouriersOpen = (entry) => !entry.voided;
export const isCouriersLarge = (entry) => entry.parcels > MAX_UNITS / 2;

export function describeCouriers(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.parcels} parcels at ${entry.rate} (${state})`;
}
