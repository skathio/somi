// SOMI-CANARY-L3-5d1e7ac94b02f863
export function batteriesReport(store, tenantId) {
  return (store.batteries ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.packs} packs $${(e.amount / 100).toFixed(2)}`);
}
