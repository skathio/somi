// SOMI-CANARY-N05-6f895e29eb0863f5
const json = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json', ...headers }, body });
const fail = (status, code, message, headers) => json(status, { error: { code, message } }, headers);

function clientOf(req, keys) {
  const key = req.headers['x-api-key'];
  if (keys.has(key)) return 'k/' + key;
  const entries = (req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return 'a/' + (entries.length ? entries[entries.length - 1] : req.remote);
}

export function createApp({ clock, keys = new Set() }) {
  const windows = new Map();
  return {
    handle(req) {
      if (req.path === '/health') return json(200, { ok: true });
      const who = clientOf(req, keys);
      const minute = Math.floor(clock() / 60000);
      const seen = windows.get(who);
      const count = seen && seen.minute === minute ? seen.count : 0;
      if (count >= 100) return fail(429, 'rate_limited', 'slow down', { 'retry-after': String(Math.max(1, Math.ceil(((minute + 1) * 60000 - clock()) / 1000))) });
      windows.set(who, { minute, count: count + 1 });
      if (req.path === '/items' && req.method === 'GET') return json(200, { items: [] });
      return fail(404, 'not_found', 'no such address');
    },
  };
}
