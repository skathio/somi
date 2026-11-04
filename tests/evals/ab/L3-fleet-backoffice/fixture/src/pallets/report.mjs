// Reports for people. Amounts print as dollars with two decimals.
const dollars = (amount) => '$' + amount.toFixed(2);

export function palletsReport(store) {
  const lines = [];
  for (const entry of store.pallets ?? []) {
    if (entry.voided) continue;
    lines.push(`${entry.id} ${entry.pallets} pallets ${dollars(entry.amount)}`);
  }
  return lines;
}

export function palletsCsv(store) {
  const rows = [['id', 'pallets', 'rate', 'amount']];
  for (const entry of store.pallets ?? []) rows.push([entry.id, entry.pallets, entry.rate.toFixed(2), entry.amount.toFixed(2)]);
  return rows.map((row) => row.join(',')).join('\n');
}

export function palletsByMonth(store) {
  const months = new Map();
  for (const entry of store.pallets ?? []) {
    if (entry.voided) continue;
    const key = new Date(entry.at).toISOString().slice(0, 7);
    months.set(key, Math.round(((months.get(key) ?? 0) + entry.amount) * 100) / 100);
  }
  return Object.fromEntries(months);
}
