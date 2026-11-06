// Medicals entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 120;

export function makeMedicalsEntry(id, input, at) {
  const problems = [];
  if (!Number.isInteger(input.drivers) || input.drivers < 1 || input.drivers > MAX_UNITS) problems.push('drivers');
  if (typeof input.rate !== 'number' || !(input.rate > 0)) problems.push('rate');
  if (problems.length > 0) throw new RangeError('invalid ' + problems.join(' and '));
  return { id, drivers: input.drivers, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isMedicalsOpen = (entry) => !entry.voided;
export const isMedicalsLarge = (entry) => entry.drivers > MAX_UNITS / 2;

export function describeMedicals(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.drivers} drivers at ${entry.rate} (${state})`;
}
