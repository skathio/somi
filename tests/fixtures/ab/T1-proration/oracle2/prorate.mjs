// SOMI-CANARY-T1-9f3a7c21b84e60d5
const MONTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const fail = (code, message) => Object.assign(new RangeError(message), { code });
const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const monthLength = (y, m) => (m === 2 && leap(y) ? 29 : MONTHS[m - 1]);
const digits = (s, from, to) => {
  let n = 0;
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) throw fail('E_DATE', 'not a date');
    n = n * 10 + (c - 48);
  }
  return n;
};

// Days since 1900-01-01, counted year by year and month by month.
function ordinal(s) {
  if (typeof s !== 'string' || s.length !== 10 || s[4] !== '-' || s[7] !== '-') throw fail('E_DATE', 'not a date');
  const y = digits(s, 0, 4);
  const m = digits(s, 5, 7);
  const d = digits(s, 8, 10);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > monthLength(y, m)) throw fail('E_DATE', 'not a date');
  let n = 0;
  for (let yy = 1900; yy < y; yy++) n += leap(yy) ? 366 : 365;
  for (let mm = 1; mm < m; mm++) n += monthLength(y, mm);
  return n + d - 1;
}

function validate(plan, a, b, c) {
  if (typeof plan !== 'number' || !Number.isInteger(plan) || plan < 0 || plan > Number.MAX_SAFE_INTEGER) throw fail('E_AMOUNT', 'bad amount');
  const x = ordinal(a);
  const y = ordinal(b);
  const z = ordinal(c);
  if (!(x < y)) throw fail('E_PERIOD', 'bad period');
  if (z < x || z > y) throw fail('E_RANGE', 'bad change date');
  return [y - x, y - z];
}

// plan * days / total, half up, without BigInt: plan = q * total + rest, so the product is q * days + rest * days / total
// with q * days <= plan and rest * days < total * total, all exact in a double.
function cents(plan, days, total) {
  const q = Math.floor(plan / total);
  const rest = plan - q * total;
  const part = rest * days;
  let low = Math.floor(part / total);
  if (2 * (part - low * total) >= total) low += 1;
  return q * days + low;
}

export function prorate(planCents, periodStart, periodEnd, changeDate) {
  const [total, remaining] = validate(planCents, periodStart, periodEnd, changeDate);
  return cents(Math.abs(planCents), remaining, total);
}

export function settle(planCents, periodStart, periodEnd, changeDate) {
  const charge = prorate(planCents, periodStart, periodEnd, changeDate);
  return { credit: Math.abs(planCents) - charge, charge };
}
