// SOMI-CANARY-L3-5d1e7ac94b02f863
export function chargersReport(store, tenantId) {
  return (store.chargers ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.sessions} sessions $${(e.amount / 100).toFixed(2)}`);
}
