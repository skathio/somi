// SOMI-CANARY-L3-5d1e7ac94b02f863
export function palletsReport(store, tenantId) {
  return (store.pallets ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.pallets} pallets $${(e.amount / 100).toFixed(2)}`);
}
