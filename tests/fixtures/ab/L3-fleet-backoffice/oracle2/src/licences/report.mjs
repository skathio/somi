// SOMI-CANARY-L3-5d1e7ac94b02f863
export function licencesReport(store, tenantId) {
  return (store.licences ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.drivers} drivers $${(e.amount / 100).toFixed(2)}`);
}
