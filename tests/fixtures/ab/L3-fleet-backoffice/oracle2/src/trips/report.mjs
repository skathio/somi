// SOMI-CANARY-L3-5d1e7ac94b02f863
export function tripsReport(store, tenantId) {
  return (store.trips ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.km} km $${(e.amount / 100).toFixed(2)}`);
}
