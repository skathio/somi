// Recovery entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 30;

export function makeRecoveryEntry(id, input, at) {
  for (const [field, ok] of [['callouts', Number.isInteger(input.callouts) && input.callouts >= 1 && input.callouts <= MAX_UNITS], ['rate', typeof input.rate === 'number' && input.rate > 0]]) {
    if (!ok) throw new RangeError(field + ' is out of range');
  }
  return { id, callouts: input.callouts, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isRecoveryOpen = (entry) => !entry.voided;
export const isRecoveryLarge = (entry) => entry.callouts > MAX_UNITS / 2;

export function describeRecovery(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.callouts} callouts at ${entry.rate} (${state})`;
}
