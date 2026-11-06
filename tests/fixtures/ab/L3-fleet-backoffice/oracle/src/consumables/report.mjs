// SOMI-CANARY-L3-5d1e7ac94b02f863
export function consumablesReport(store, tenantId) {
  return (store.consumables ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.boxes} boxes $${(e.amount / 100).toFixed(2)}`);
}
