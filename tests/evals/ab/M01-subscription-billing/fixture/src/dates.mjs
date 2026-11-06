const DAY_MS = 24 * 60 * 60 * 1000;
const parse = (day) => Date.parse(`${day}T00:00:00Z`);

export const isDay = (day) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(parse(day));

export function addDays(day, n) {
  return new Date(parse(day) + n * DAY_MS).toISOString().slice(0, 10);
}

// Whole days from `from` up to, but not including, `to`.
export function daysBetween(from, to) {
  return Math.round((parse(to) - parse(from)) / DAY_MS);
}
