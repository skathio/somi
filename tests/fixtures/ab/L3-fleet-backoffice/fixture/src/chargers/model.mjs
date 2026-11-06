// Chargers entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 600;

export function makeChargersEntry(id, input, at) {
  const problems = [];
  if (!Number.isInteger(input.sessions) || input.sessions < 1 || input.sessions > MAX_UNITS) problems.push('sessions');
  if (typeof input.rate !== 'number' || !(input.rate > 0)) problems.push('rate');
  if (problems.length > 0) throw new RangeError('invalid ' + problems.join(' and '));
  return { id, sessions: input.sessions, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isChargersOpen = (entry) => !entry.voided;
export const isChargersLarge = (entry) => entry.sessions > MAX_UNITS / 2;

export function describeChargers(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.sessions} sessions at ${entry.rate} (${state})`;
}
