// SOMI-CANARY-L3-5d1e7ac94b02f863
export function rentalsReport(store, tenantId) {
  return (store.rentals ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.days} days $${(e.amount / 100).toFixed(2)}`);
}
