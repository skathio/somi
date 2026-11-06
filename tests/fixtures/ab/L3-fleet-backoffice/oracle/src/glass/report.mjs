// SOMI-CANARY-L3-5d1e7ac94b02f863
export function glassReport(store, tenantId) {
  return (store.glass ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.panes} panes $${(e.amount / 100).toFixed(2)}`);
}
