// Uniforms entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 120;

export function makeUniformsEntry(id, input, at) {
  for (const [field, ok] of [['sets', Number.isInteger(input.sets) && input.sets >= 1 && input.sets <= MAX_UNITS], ['rate', typeof input.rate === 'number' && input.rate > 0]]) {
    if (!ok) throw new RangeError(field + ' is out of range');
  }
  return { id, sets: input.sets, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isUniformsOpen = (entry) => !entry.voided;
export const isUniformsLarge = (entry) => entry.sets > MAX_UNITS / 2;

export function describeUniforms(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.sets} sets at ${entry.rate} (${state})`;
}
