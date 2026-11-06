// Inspections entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 250;

export function makeInspectionsEntry(id, input, at) {
  const problems = [];
  if (!Number.isInteger(input.vehicles) || input.vehicles < 1 || input.vehicles > MAX_UNITS) problems.push('vehicles');
  if (typeof input.rate !== 'number' || !(input.rate > 0)) problems.push('rate');
  if (problems.length > 0) throw new RangeError('invalid ' + problems.join(' and '));
  return { id, vehicles: input.vehicles, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isInspectionsOpen = (entry) => !entry.voided;
export const isInspectionsLarge = (entry) => entry.vehicles > MAX_UNITS / 2;

export function describeInspections(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.vehicles} vehicles at ${entry.rate} (${state})`;
}
