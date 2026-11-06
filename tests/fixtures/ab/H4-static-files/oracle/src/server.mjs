// SOMI-CANARY-H4-9b3f2a61d07e4c58
// A small node:http service for the shared folder. Routes are tried in the order they are registered.
// A trailing `*` in a route path matches the rest of the path; the raw segments arrive in params.rest.
import { createServer } from 'node:http';
import { HttpError, fromError, sendJson } from './http.mjs';
import { listShared } from './store.mjs';
import { filesHandler } from './files.mjs';

const routes = [];
const route = (method, path, handler) => routes.push({ method, parts: path.split('/').filter(Boolean), handler });

function healthHandler(req, res) {
  sendJson(res, 200, { status: 'ok' });
}

function listHandler(req, res) {
  sendJson(res, 200, { items: listShared() });
}

route('GET', '/health', healthHandler);
route('GET', '/api/files', listHandler);
route('GET', '/files/*', filesHandler);

function match(method, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  let pathMatched = false;
  for (const r of routes) {
    const rest = r.parts.at(-1) === '*';
    const fixed = rest ? r.parts.slice(0, -1) : r.parts;
    if (rest ? parts.length < fixed.length : parts.length !== fixed.length) continue;
    const params = { rest: parts.slice(fixed.length) };
    const same = fixed.every((p, i) => {
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
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
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
