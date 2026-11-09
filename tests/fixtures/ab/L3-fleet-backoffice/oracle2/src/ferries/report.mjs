// SOMI-CANARY-L3-5d1e7ac94b02f863
export function ferriesReport(store, tenantId) {
  return (store.ferries ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.sailings} sailings $${(e.amount / 100).toFixed(2)}`);
}
