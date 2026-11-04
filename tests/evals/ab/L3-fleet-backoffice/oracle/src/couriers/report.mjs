// SOMI-CANARY-L3-5d1e7ac94b02f863
export function couriersReport(store, tenantId) {
  return (store.couriers ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.parcels} parcels $${(e.amount / 100).toFixed(2)}`);
}
