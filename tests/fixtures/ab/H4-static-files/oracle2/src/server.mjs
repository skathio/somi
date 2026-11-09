// SOMI-CANARY-H4-9b3f2a61d07e4c58
// A small node:http service for the shared folder. Routes are tried in the order they are registered.
import { createServer } from 'node:http';
import { HttpError, fromError, sendJson } from './http.mjs';
import { listShared } from './store.mjs';
import { share } from './share.mjs';

const routes = [];
const route = (method, path, handler) => routes.push({ method, parts: path.split('/').filter(Boolean), handler });

route('GET', '/health', (req, res) => sendJson(res, 200, { status: 'ok' }));
route('GET', '/api/files', (req, res) => sendJson(res, 200, { items: listShared() }));

function match(method, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  let pathMatched = false;
  for (const r of routes) {
    if (r.parts.length !== parts.length) continue;
    const params = {};
    const same = r.parts.every((p, i) => {
      if (!p.startsWith(':')) return p === parts[i];
      params[p.slice(1)] = decodeURIComponent(parts[i]);
      return true;
    });
    if (!same) continue;
    pathMatched = true;
    if (r.method === method) return { handler: r.handler, params };
  }
  return { pathMatched };
}

export async function start({ port = 0 } = {}) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (/^\/files(\/|$)/.test(url.pathname)) return await share(req, res, url.pathname);
      const found = match(req.method, url.pathname);
      if (found.handler) return found.handler(req, res, found.params, url);
      if (found.pathMatched) throw new HttpError(405, 'method_not_allowed', 'method not allowed');
      throw new HttpError(404, 'not_found', 'no such route');
    } catch (err) {
      return fromError(res, err);
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}
