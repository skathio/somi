// SOMI-CANARY-T1-9f3a7c21b84e60d5
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const fail = (code, message) => Object.assign(new RangeError(message), { code });

// Whole days since 1970-01-01 for a valid 'YYYY-MM-DD' string, or an E_DATE RangeError.
function dayNumber(value) {
  const m = typeof value === 'string' ? DATE.exec(value) : null;
  if (m === null) throw fail('E_DATE', 'a date must be a YYYY-MM-DD string');
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2100) throw fail('E_DATE', 'the year must be from 1900 to 2100');
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) throw fail('E_DATE', 'not a calendar date');
  return ms / 86400000;
}

// The checks run in a fixed order; the first failure decides the code.
function check(planCents, periodStart, periodEnd, changeDate) {
  if (!Number.isSafeInteger(planCents) || planCents < 0) throw fail('E_AMOUNT', 'planCents must be a safe integer, 0 or more');
  const start = dayNumber(periodStart);
  const end = dayNumber(periodEnd);
  const change = dayNumber(changeDate);
  if (start >= end) throw fail('E_PERIOD', 'periodStart must be before periodEnd');
  if (change < start || change > end) throw fail('E_RANGE', 'changeDate must be within the period');
  return { total: end - start, remaining: end - change };
}

// planCents * days / total rounded half up, exactly.
function share(planCents, days, total) {
  return Number((2n * BigInt(planCents) * BigInt(days) + BigInt(total)) / (2n * BigInt(total)));
}

export function prorate(planCents, periodStart, periodEnd, changeDate) {
  const { total, remaining } = check(planCents, periodStart, periodEnd, changeDate);
  return share(planCents, remaining, total);
}

export function settle(planCents, periodStart, periodEnd, changeDate) {
  const { total, remaining } = check(planCents, periodStart, periodEnd, changeDate);
  const charge = share(planCents, remaining, total);
  return { credit: planCents - charge + 0, charge };
}
