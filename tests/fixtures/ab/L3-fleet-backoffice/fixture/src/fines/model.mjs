// Fines entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 30;

export function makeFinesEntry(id, input, at) {
  if (!Number.isInteger(input.points) || input.points < 1 || input.points > MAX_UNITS) throw new RangeError('points must be a whole number from 1 to ' + MAX_UNITS);
  if (typeof input.rate !== 'number' || !(input.rate > 0)) throw new RangeError('rate must be a positive number of dollars');
  return { id, points: input.points, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isFinesOpen = (entry) => !entry.voided;
export const isFinesLarge = (entry) => entry.points > MAX_UNITS / 2;

export function describeFines(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.points} points at ${entry.rate} (${state})`;
}
