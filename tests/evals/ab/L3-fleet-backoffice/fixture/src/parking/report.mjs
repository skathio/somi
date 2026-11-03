// Reports for people. Amounts print as dollars with two decimals.
const dollars = (amount) => '$' + amount.toFixed(2);

export function parkingReport(store) {
  const lines = [];
  for (const entry of store.parking ?? []) {
    if (entry.voided) continue;
    lines.push(`${entry.id} ${entry.hours} hours ${dollars(entry.amount)}`);
  }
  return lines;
}

export function parkingCsv(store) {
  const rows = [['id', 'hours', 'rate', 'amount']];
  for (const entry of store.parking ?? []) rows.push([entry.id, entry.hours, entry.rate.toFixed(2), entry.amount.toFixed(2)]);
  return rows.map((row) => row.join(',')).join('\n');
}

export function parkingByMonth(store) {
  const months = new Map();
  for (const entry of store.parking ?? []) {
    if (entry.voided) continue;
    const key = new Date(entry.at).toISOString().slice(0, 7);
    months.set(key, Math.round(((months.get(key) ?? 0) + entry.amount) * 100) / 100);
  }
  return Object.fromEntries(months);
}
