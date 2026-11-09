// SOMI-CANARY-N05-6f895e29eb0863f5
import { createLimiter } from './limit.mjs';

const json = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json', ...headers }, body });
const fail = (status, code, message, headers) => json(status, { error: { code, message } }, headers);

export function createApp({ clock, keys = new Set() }) {
  const limiter = createLimiter({ clock, keys });
  return {
    handle(req) {
      if (req.path !== '/health' && !limiter.allow(req)) return fail(429, 'rate_limited', 'too many requests', { 'retry-after': String(limiter.wait) });
      if (req.path === '/health') return json(200, { ok: true });
      if (req.path === '/items' && req.method === 'GET') return json(200, { items: [] });
      return fail(404, 'not_found', 'no such address');
    },
  };
}
