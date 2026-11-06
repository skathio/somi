// Reports for people. Amounts print as dollars with two decimals.
const dollars = (amount) => '$' + amount.toFixed(2);

export function tiresReport(store) {
  const lines = [];
  for (const entry of store.tires ?? []) {
    if (entry.voided) continue;
    lines.push(`${entry.id} ${entry.tires} tires ${dollars(entry.amount)}`);
  }
  return lines;
}

export function tiresCsv(store) {
  const rows = [['id', 'tires', 'rate', 'amount']];
  for (const entry of store.tires ?? []) rows.push([entry.id, entry.tires, entry.rate.toFixed(2), entry.amount.toFixed(2)]);
  return rows.map((row) => row.join(',')).join('\n');
}

export function tiresByMonth(store) {
  const months = new Map();
  for (const entry of store.tires ?? []) {
    if (entry.voided) continue;
    const key = new Date(entry.at).toISOString().slice(0, 7);
    months.set(key, Math.round(((months.get(key) ?? 0) + entry.amount) * 100) / 100);
  }
  return Object.fromEntries(months);
}
