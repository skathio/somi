// SOMI-CANARY-L3-5d1e7ac94b02f863
export function tollsReport(store, tenantId) {
  return (store.tolls ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.crossings} crossings $${(e.amount / 100).toFixed(2)}`);
}
