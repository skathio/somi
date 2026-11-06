// SOMI-CANARY-L3-5d1e7ac94b02f863
export function finesReport(store, tenantId) {
  return (store.fines ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.points} points $${(e.amount / 100).toFixed(2)}`);
}
