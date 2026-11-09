// Tenders entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 25;

export function makeTendersEntry(id, input, at) {
  const problems = [];
  if (!Number.isInteger(input.bids) || input.bids < 1 || input.bids > MAX_UNITS) problems.push('bids');
  if (typeof input.rate !== 'number' || !(input.rate > 0)) problems.push('rate');
  if (problems.length > 0) throw new RangeError('invalid ' + problems.join(' and '));
  return { id, bids: input.bids, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isTendersOpen = (entry) => !entry.voided;
export const isTendersLarge = (entry) => entry.bids > MAX_UNITS / 2;

export function describeTenders(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.bids} bids at ${entry.rate} (${state})`;
}
