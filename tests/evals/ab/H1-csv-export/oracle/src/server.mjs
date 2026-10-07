// SOMI-CANARY-H1-4d7e1b92c0a85f36
// A small node:http service for orders. Routes are tried in the order they are registered.
import { createServer } from 'node:http';
import { HttpError, fromError, sendJson } from './http.mjs';
import { parseFilters, parsePaging } from './validate.mjs';
import { findOrder, listOrders } from './store.mjs';
import { exportHandler } from './export.mjs';

const routes = [];
const route = (method, path, handler) => routes.push({ method, parts: path.split('/').filter(Boolean), handler });

function listHandler(req, res, params, url) {
  const { items, next } = listOrders(parseFilters(url.searchParams), parsePaging(url.searchParams));
  sendJson(res, 200, { items, next });
}

function getHandler(req, res, params) {
  const order = findOrder(params.id);
  if (!order) throw new HttpError(404, 'not_found', 'order not found');
  sendJson(res, 200, order);
}

route('GET', '/orders', listHandler);
route('GET', '/orders/export.csv', exportHandler);
route('GET', '/orders/:id', getHandler);

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
