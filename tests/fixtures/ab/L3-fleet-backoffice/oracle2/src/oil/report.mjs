// SOMI-CANARY-L3-5d1e7ac94b02f863
export function oilReport(store, tenantId) {
  return (store.oil ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.litres} litres $${(e.amount / 100).toFixed(2)}`);
}
