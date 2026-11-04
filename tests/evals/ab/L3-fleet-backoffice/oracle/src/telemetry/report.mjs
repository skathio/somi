// SOMI-CANARY-L3-5d1e7ac94b02f863
export function telemetryReport(store, tenantId) {
  return (store.telemetry ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => `${e.id} ${e.devices} devices $${(e.amount / 100).toFixed(2)}`);
}
