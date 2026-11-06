// SOMI-CANARY-N03-39d35df7f9c374df
import { config } from './config.mjs';

export function businessDay(at, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
  return parts;
}

export function dailyReport(orders, year, month, tz = config.timeZone) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const out = {};
  for (let d = 1; d <= days; d++) out[`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`] = 0;
  for (const o of orders) {
    const day = businessDay(o.at, tz);
    if (day in out) out[day] += o.amount;
  }
  return out;
}

export function periodTotal(orders, from, to, tz = config.timeZone) {
  return orders.filter((o) => { const day = businessDay(o.at, tz); return day >= from && day <= to; }).reduce((s, o) => s + o.amount, 0);
}

export function weeklyReport(orders, tz = config.timeZone) {
  const out = {};
  for (const o of orders) {
    const day = businessDay(o.at, tz);
    const week = monday(day);
    out[week] = (out[week] ?? 0) + o.amount;
  }
  return out;
}

function monday(day) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
