// Public ingestion endpoint. Accepts a tenant payload, validates, persists.
import { insertRecord } from '../db/client.mjs';

export async function handleIngest(req) {
  const { tenantId, payload } = req.body ?? {};
  if (!tenantId || typeof payload !== 'object') {
    return { status: 400, body: { error: 'tenantId and payload are required' } };
  }
  const record = await insertRecord(tenantId, payload);
  return { status: 202, body: { id: record.id } };
}
