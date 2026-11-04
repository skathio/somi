// SOMI-CANARY-L1-60349bdfbf51ffa8
export function monthlyStatement(store, year, month) {
  const start = Date.UTC(year, month - 1, 1);
  const end = Date.UTC(year, month, 1);
  const inMonth = (at) => at >= start && at < end;
  const orders = store.orders.filter((o) => inMonth(o.at));
  const refunds = store.refunds.filter((r) => inMonth(r.at)).reduce((s, r) => s + r.amount, 0);
  const gross = orders.reduce((s, o) => s + o.total, 0);
  return { orders: orders.length, gross, refunds, net: gross - refunds };
}
