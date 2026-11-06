// Reports for people. Amounts print as dollars with two decimals.
const dollars = (amount) => '$' + amount.toFixed(2);

export function bridgesReport(store) {
  const lines = [];
  for (const entry of store.bridges ?? []) {
    if (entry.voided) continue;
    lines.push(`${entry.id} ${entry.crossings} crossings ${dollars(entry.amount)}`);
  }
  return lines;
}

export function bridgesCsv(store) {
  const rows = [['id', 'crossings', 'rate', 'amount']];
  for (const entry of store.bridges ?? []) rows.push([entry.id, entry.crossings, entry.rate.toFixed(2), entry.amount.toFixed(2)]);
  return rows.map((row) => row.join(',')).join('\n');
}

export function bridgesByMonth(store) {
  const months = new Map();
  for (const entry of store.bridges ?? []) {
    if (entry.voided) continue;
    const key = new Date(entry.at).toISOString().slice(0, 7);
    months.set(key, Math.round(((months.get(key) ?? 0) + entry.amount) * 100) / 100);
  }
  return Object.fromEntries(months);
}
