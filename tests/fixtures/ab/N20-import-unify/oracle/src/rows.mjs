// SOMI-CANARY-N20-7a7f1e4433d0a5f1
export function importRows(rows, { email, parse, blank, keep, accept = () => true }) {
  const seen = new Map();
  let skipped = 0;
  for (const row of rows) {
    const address = email(row.email);
    const key = `${row.ref}|${address}`;
    if (keep === 'first' && seen.has(key)) continue;
    const text = row.amount.trim();
    if (text === '' && blank === 'skip') { skipped++; continue; }
    const amount = text === '' ? 0 : parse(text);
    if (Number.isNaN(amount) || !accept(amount)) { skipped++; continue; }
    seen.delete(key);
    seen.set(key, { ref: row.ref, email: address, amount });
  }
  return { items: [...seen.values()], skipped };
}
