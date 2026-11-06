// SOMI-CANARY-L3-5d1e7ac94b02f863
export function uniformsReport(store, tenantId) {
  return (store.uniforms ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.sets} sets $${(e.amount / 100).toFixed(2)}`);
}
