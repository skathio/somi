// SOMI-CANARY-L3-5d1e7ac94b02f863
export function tendersReport(store, tenantId) {
  return (store.tenders ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.bids} bids $${(e.amount / 100).toFixed(2)}`);
}
