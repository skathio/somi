// SOMI-CANARY-L3-5d1e7ac94b02f863
export function recoveryReport(store, tenantId) {
  return (store.recovery ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.callouts} callouts $${(e.amount / 100).toFixed(2)}`);
}
