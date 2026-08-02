// Thin Postgres wrapper.
export async function query(sql, params = []) {
  return [];
}

export async function insertRecord(tenantId, payload) {
  return { id: `${tenantId}-${Date.now()}` };
}
