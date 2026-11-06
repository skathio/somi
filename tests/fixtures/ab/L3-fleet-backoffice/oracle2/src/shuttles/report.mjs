// SOMI-CANARY-L3-5d1e7ac94b02f863
export function shuttlesReport(store, tenantId) {
  return (store.shuttles ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.runs} runs $${(e.amount / 100).toFixed(2)}`);
}
