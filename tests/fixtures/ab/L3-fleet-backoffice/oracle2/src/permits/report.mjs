// SOMI-CANARY-L3-5d1e7ac94b02f863
export function permitsReport(store, tenantId) {
  return (store.permits ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.permits} permits $${(e.amount / 100).toFixed(2)}`);
}
