export function post(store, ref, entries) {
  const sum = entries.reduce((s, e) => s + e.amount, 0);
  if (sum !== 0) throw new Error(`unbalanced transaction ${ref}`);
  for (const e of entries) store.ledger.push({ ref, ...e });
}
export const balance = (store, account) => store.ledger.filter((e) => e.account === account).reduce((s, e) => s + e.amount, 0);
