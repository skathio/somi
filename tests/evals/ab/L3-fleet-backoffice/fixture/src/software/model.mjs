// Software entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 500;

export function makeSoftwareEntry(id, input, at) {
  for (const [field, ok] of [['seats', Number.isInteger(input.seats) && input.seats >= 1 && input.seats <= MAX_UNITS], ['rate', typeof input.rate === 'number' && input.rate > 0]]) {
    if (!ok) throw new RangeError(field + ' is out of range');
  }
  return { id, seats: input.seats, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isSoftwareOpen = (entry) => !entry.voided;
export const isSoftwareLarge = (entry) => entry.seats > MAX_UNITS / 2;

export function describeSoftware(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.seats} seats at ${entry.rate} (${state})`;
}
