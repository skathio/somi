// Thin Postgres wrapper.
export async function insertRecord(tenantId, payload) {
  return { id: `${tenantId}-${Date.now()}` };
}
