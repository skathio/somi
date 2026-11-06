// SOMI-CANARY-L3-5d1e7ac94b02f863
export function scalesReport(store, tenantId) {
  return (store.scales ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.weighings} weighings $${(e.amount / 100).toFixed(2)}`);
}
