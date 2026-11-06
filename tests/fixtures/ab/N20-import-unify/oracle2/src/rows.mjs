// SOMI-CANARY-N20-7a7f1e4433d0a5f1
const toCents = (text, round) => round(Number(text.replaceAll(',', '')) * 100);

export function importRows(rows, o) {
  const items = [];
  const at = new Map();
  let skipped = 0;
  rows.forEach((row) => {
    const email = o.fold ? row.email.trim().toLowerCase() : row.email.trim();
    const key = row.ref + '|' + email;
    if (o.firstWins && at.has(key)) return;
    const text = row.amount.trim();
    if (o.skipBlank && !text) { skipped += 1; return; }
    const amount = text ? toCents(text, o.round) : 0;
    if (amount !== amount || (o.positive && amount <= 0)) { skipped += 1; return; }
    if (at.has(key)) items.splice(at.get(key), 1);
    if (at.has(key)) for (const [k, i] of at) if (i > at.get(key)) at.set(k, i - 1);
    at.set(key, items.length);
    items.push({ ref: row.ref, email, amount });
  });
  return { items, skipped };
}
