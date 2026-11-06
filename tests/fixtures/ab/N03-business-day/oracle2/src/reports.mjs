// SOMI-CANARY-N03-39d35df7f9c374df
import { config } from './config.mjs';
import { mondayOf, wallDate } from './calendar.mjs';

export function dailyReport(orders, year, month, tz = config.timeZone) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const out = Object.fromEntries(Array.from({ length: count }, (_, i) => [`${prefix}-${String(i + 1).padStart(2, '0')}`, 0]));
  for (const { at, amount } of orders) {
    const key = wallDate(at, tz);
    if (Object.hasOwn(out, key)) out[key] += amount;
  }
  return out;
}

export function periodTotal(orders, from, to, tz = config.timeZone) {
  let sum = 0;
  for (const { at, amount } of orders) {
    const key = wallDate(at, tz);
    if (from <= key && key <= to) sum += amount;
  }
  return sum;
}

export function weeklyReport(orders, tz = config.timeZone) {
  return orders.reduce((out, { at, amount }) => {
    const week = mondayOf(wallDate(at, tz));
    return { ...out, [week]: (out[week] ?? 0) + amount };
  }, {});
}
