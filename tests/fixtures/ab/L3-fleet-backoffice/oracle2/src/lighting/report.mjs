// SOMI-CANARY-L3-5d1e7ac94b02f863
export function lightingReport(store, tenantId) {
  return (store.lighting ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.lamps} lamps $${(e.amount / 100).toFixed(2)}`);
}
