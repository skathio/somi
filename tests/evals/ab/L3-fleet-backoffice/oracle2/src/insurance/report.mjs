// SOMI-CANARY-L3-5d1e7ac94b02f863
export function insuranceReport(store, tenantId) {
  return (store.insurance ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.vehicles} vehicles $${(e.amount / 100).toFixed(2)}`);
}
