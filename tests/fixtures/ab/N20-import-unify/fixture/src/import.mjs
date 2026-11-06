export function importOrders(rows) {
  const seen = new Map();
  let skipped = 0;
  for (const row of rows) {
    const key = `${row.ref}|${row.email.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    const text = row.amount.trim();
    if (text === '') { skipped++; continue; }
    const amount = Math.round(Number(text.replaceAll(',', '')) * 100);
    if (Number.isNaN(amount)) { skipped++; continue; }
    seen.set(key, { ref: row.ref, email: row.email.trim().toLowerCase(), amount });
  }
  return { items: [...seen.values()], skipped };
}

export function importRefunds(rows) {
  const seen = new Map();
  let skipped = 0;
  for (const row of rows) {
    const key = `${row.ref}|${row.email.trim()}`;
    const text = row.amount.trim();
    const amount = text === '' ? 0 : Math.trunc(Number(text.replaceAll(',', '')) * 100);
    if (Number.isNaN(amount)) { skipped++; continue; }
    seen.delete(key);
    seen.set(key, { ref: row.ref, email: row.email.trim(), amount });
  }
  return { items: [...seen.values()], skipped };
}
