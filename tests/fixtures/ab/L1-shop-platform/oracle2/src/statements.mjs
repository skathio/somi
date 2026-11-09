// SOMI-CANARY-L1-60349bdfbf51ffa8
export function monthlyStatement(store, year, month) {
  const key = (ms) => { const d = new Date(ms); return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1; };
  const want = year * 100 + month;
  const placed = store.orders.filter((o) => key(o.at) === want);
  const back = store.refunds.filter((r) => key(r.at) === want).reduce((s, r) => s + r.amount, 0);
  const gross = placed.reduce((s, o) => s + o.total, 0);
  return { orders: placed.length, gross, refunds: back, net: gross - back };
}
