// Public ingestion endpoint. Accepts a tenant payload, validates, persists.
import { insertRecord } from '../db/client.mjs';
import { tenantForKey } from '../auth/api-key.mjs';

export async function handleIngest(req) {
  const tenantId = await tenantForKey(req.headers?.['x-api-key']);
  if (!tenantId) {
    return { status: 401, body: { error: 'unknown or revoked api key' } };
  }
  const { payload } = req.body ?? {};
  if (typeof payload !== 'object' || payload === null) {
    return { status: 400, body: { error: 'payload is required' } };
  }
  const record = await insertRecord(tenantId, payload);
  return { status: 202, body: { id: record.id } };
}
