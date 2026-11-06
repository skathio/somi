// SOMI-CANARY-L3-5d1e7ac94b02f863
export function tiresReport(store, tenantId) {
  return (store.tires ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.tires} tires $${(e.amount / 100).toFixed(2)}`);
}
