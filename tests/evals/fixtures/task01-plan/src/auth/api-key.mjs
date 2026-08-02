// API-key lookup. Maps a presented key to the tenant it belongs to.
import { query } from '../db/client.mjs';

const sha256 = async (s) => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(s).digest('hex');
};

export async function tenantForKey(presented) {
  if (typeof presented !== 'string' || presented.length === 0) return null;
  const rows = await query(
    'SELECT tenant_id FROM api_keys WHERE hash = $1 AND revoked_at IS NULL',
    [await sha256(presented)],
  );
  return rows[0]?.tenant_id ?? null;
}
