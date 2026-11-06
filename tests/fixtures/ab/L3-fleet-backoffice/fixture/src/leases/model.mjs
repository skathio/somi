// Leases entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 72;

export function makeLeasesEntry(id, input, at) {
  for (const [field, ok] of [['months', Number.isInteger(input.months) && input.months >= 1 && input.months <= MAX_UNITS], ['rate', typeof input.rate === 'number' && input.rate > 0]]) {
    if (!ok) throw new RangeError(field + ' is out of range');
  }
  return { id, months: input.months, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isLeasesOpen = (entry) => !entry.voided;
export const isLeasesLarge = (entry) => entry.months > MAX_UNITS / 2;

export function describeLeases(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.months} months at ${entry.rate} (${state})`;
}
