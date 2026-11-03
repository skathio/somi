// Lighting entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 110;

export function makeLightingEntry(id, input, at) {
  const problems = [];
  if (!Number.isInteger(input.lamps) || input.lamps < 1 || input.lamps > MAX_UNITS) problems.push('lamps');
  if (typeof input.rate !== 'number' || !(input.rate > 0)) problems.push('rate');
  if (problems.length > 0) throw new RangeError('invalid ' + problems.join(' and '));
  return { id, lamps: input.lamps, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isLightingOpen = (entry) => !entry.voided;
export const isLightingLarge = (entry) => entry.lamps > MAX_UNITS / 2;

export function describeLighting(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.lamps} lamps at ${entry.rate} (${state})`;
}
