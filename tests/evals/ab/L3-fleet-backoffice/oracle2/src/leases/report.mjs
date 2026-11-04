// SOMI-CANARY-L3-5d1e7ac94b02f863
export function leasesReport(store, tenantId) {
  return (store.leases ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.months} months $${(e.amount / 100).toFixed(2)}`);
}
