// SOMI-CANARY-L3-5d1e7ac94b02f863
export function trainingReport(store, tenantId) {
  return (store.training ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.seats} seats $${(e.amount / 100).toFixed(2)}`);
}
