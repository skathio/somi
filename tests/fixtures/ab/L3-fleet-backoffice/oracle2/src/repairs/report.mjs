// SOMI-CANARY-L3-5d1e7ac94b02f863
export function repairsReport(store, tenantId) {
  return (store.repairs ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.hours} hours $${(e.amount / 100).toFixed(2)}`);
}
