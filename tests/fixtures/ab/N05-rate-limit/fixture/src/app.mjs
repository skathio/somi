const json = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json', ...headers }, body });
const fail = (status, code, message, headers) => json(status, { error: { code, message } }, headers);

export function createApp({ clock, keys = new Set() }) {
  return {
    handle(req) {
      if (req.path === '/health') return json(200, { ok: true });
      if (req.path === '/items' && req.method === 'GET') return json(200, { items: [] });
      return fail(404, 'not_found', 'no such address');
    },
  };
}
