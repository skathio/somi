// SOMI-CANARY-L3-5d1e7ac94b02f863
export function customsReport(store, tenantId) {
  return (store.customs ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.declarations} declarations $${(e.amount / 100).toFixed(2)}`);
}
