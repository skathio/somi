// Audits entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 20;

export function makeAuditsEntry(id, input, at) {
  for (const [field, ok] of [['sites', Number.isInteger(input.sites) && input.sites >= 1 && input.sites <= MAX_UNITS], ['rate', typeof input.rate === 'number' && input.rate > 0]]) {
    if (!ok) throw new RangeError(field + ' is out of range');
  }
  return { id, sites: input.sites, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isAuditsOpen = (entry) => !entry.voided;
export const isAuditsLarge = (entry) => entry.sites > MAX_UNITS / 2;

export function describeAudits(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.sites} sites at ${entry.rate} (${state})`;
}
