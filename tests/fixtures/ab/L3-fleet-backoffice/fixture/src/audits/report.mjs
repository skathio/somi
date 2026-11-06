// Reports for people. Amounts print as dollars with two decimals.
const dollars = (amount) => '$' + amount.toFixed(2);

export function auditsReport(store) {
  const lines = [];
  for (const entry of store.audits ?? []) {
    if (entry.voided) continue;
    lines.push(`${entry.id} ${entry.sites} sites ${dollars(entry.amount)}`);
  }
  return lines;
}

export function auditsCsv(store) {
  const rows = [['id', 'sites', 'rate', 'amount']];
  for (const entry of store.audits ?? []) rows.push([entry.id, entry.sites, entry.rate.toFixed(2), entry.amount.toFixed(2)]);
  return rows.map((row) => row.join(',')).join('\n');
}

export function auditsByMonth(store) {
  const months = new Map();
  for (const entry of store.audits ?? []) {
    if (entry.voided) continue;
    const key = new Date(entry.at).toISOString().slice(0, 7);
    months.set(key, Math.round(((months.get(key) ?? 0) + entry.amount) * 100) / 100);
  }
  return Object.fromEntries(months);
}
