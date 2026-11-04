import { config } from './config.mjs';

// { 'YYYY-MM-DD': total } for one month, every day of the month present.
export function dailyReport(orders, year, month, tz = config.timeZone) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const out = {};
  for (let d = 1; d <= days; d++) out[`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`] = 0;
  for (const o of orders) {
    const day = o.at.slice(0, 10);
    if (day in out) out[day] += o.amount;
  }
  return out;
}

// Total of the orders in a period of dates.
export function periodTotal(orders, from, to, tz = config.timeZone) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return orders.filter((o) => Date.parse(o.at) >= start && Date.parse(o.at) < end).reduce((s, o) => s + o.amount, 0);
}

// { 'YYYY-MM-DD' (the Monday of the week): total }.
export function weeklyReport(orders, tz = config.timeZone) {
  const out = {};
  for (const o of orders) {
    const d = new Date(o.at);
    const back = (d.getUTCDay() + 6) % 7;
    const week = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
    out[week] = (out[week] ?? 0) + o.amount;
  }
  return out;
}
