// SOMI-CANARY-L3-5d1e7ac94b02f863
export function washesReport(store, tenantId) {
  return (store.washes ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.washes} washes $${(e.amount / 100).toFixed(2)}`);
}
