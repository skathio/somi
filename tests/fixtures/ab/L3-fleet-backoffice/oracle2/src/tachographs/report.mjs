// SOMI-CANARY-L3-5d1e7ac94b02f863
export function tachographsReport(store, tenantId) {
  return (store.tachographs ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.units} units $${(e.amount / 100).toFixed(2)}`);
}
