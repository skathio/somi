// SOMI-CANARY-H4-9b3f2a61d07e4c58
// GET /files/...: files (with byte ranges) and folder pages from the shared folder.
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { HttpError } from './http.mjs';
import { SHARED_DIR } from './store.mjs';

const KINDS = new Map([
  ['.txt', 'text/plain; charset=utf-8'], ['.json', 'application/json; charset=utf-8'], ['.csv', 'text/csv; charset=utf-8'],
  ['.png', 'image/png'], ['.pdf', 'application/pdf'], ['.html', 'text/html; charset=utf-8'], ['.svg', 'image/svg+xml'],
]);
const SAVE_ONLY = ['.html', '.svg'];
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const html = (s) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);
const url = (names) => names.map((n) => encodeURIComponent(n).replace(/'/g, '%27')).join('/');
const NOT_FOUND = () => new HttpError(404, 'not_found', 'no such file or folder');

function locate(pathname) {
  const names = pathname.split('/').slice(2).filter((s) => s !== '').map((s) => {
    try { return decodeURIComponent(s); } catch { throw new HttpError(400, 'invalid_path', 'malformed path'); }
  });
  if (names.some((n) => n.includes('/') || n.includes('\\') || n.includes('\0') || n === '..' || n === '.')) throw new HttpError(400, 'invalid_path', 'invalid path');
  const target = resolve(SHARED_DIR, ...names);
  const inside = relative(SHARED_DIR, target);
  if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw NOT_FOUND();
  return { names, target };
}

function wanted(header, size) {
  if (!header || !header.startsWith('bytes=')) return null;
  const spec = header.slice(6);
  const dash = spec.indexOf('-');
  const a = spec.slice(0, dash);
  const b = spec.slice(dash + 1);
  if (dash < 0 || !/^\d*$/.test(a) || !/^\d*$/.test(b) || (a === '' && b === '')) return null;
  if (a === '') return Number(b) === 0 || size === 0 ? false : [Math.max(size - Number(b), 0), size - 1];
  if (b !== '' && Number(b) < Number(a)) return null;
  return Number(a) >= size ? false : [Number(a), Math.min(b === '' ? size - 1 : Number(b), size - 1)];
}

function download(req, res, target, size) {
  const range = wanted(req.headers.range, size);
  if (range === false) throw new HttpError(416, 'range_not_satisfiable', 'range not satisfiable', { 'content-range': `bytes */${size}` });
  const [from, to] = range ?? [0, size - 1];
  const ext = extname(target).toLowerCase();
  res.setHeader('content-type', KINDS.get(ext) ?? 'application/octet-stream');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('accept-ranges', 'bytes');
  if (SAVE_ONLY.includes(ext)) res.setHeader('content-disposition', 'attachment');
  res.setHeader('content-length', String(to - from + 1));
  if (range) res.setHeader('content-range', `bytes ${from}-${to}/${size}`);
  res.statusCode = range ? 206 : 200;
  if (size === 0) return res.end();
  createReadStream(target, { start: from, end: to }).on('error', () => res.destroy()).pipe(res);
}

async function folderPage(res, names, target) {
  const found = [];
  for (const d of await readdir(target, { withFileTypes: true })) {
    if (d.isDirectory()) found.push({ name: d.name, folder: true });
    else if (d.isFile()) found.push({ name: d.name, folder: false, size: (await stat(resolve(target, d.name))).size });
  }
  found.sort((p, q) => (p.folder === q.folder ? (p.name.toLowerCase() < q.name.toLowerCase() ? -1 : p.name.toLowerCase() > q.name.toLowerCase() ? 1 : 0) : p.folder ? -1 : 1));
  const here = `/files/${names.length ? `${names.join('/')}/` : ''}`;
  const rows = found.map((f) => `<tr><td><a href="/files/${url([...names, f.name])}${f.folder ? '/' : ''}">${html(f.name)}${f.folder ? '/' : ''}</a></td><td>${f.folder ? '' : `${f.size} bytes`}</td></tr>`);
  const back = names.length ? `<p><a href="/files/${url(names.slice(0, -1))}${names.length > 1 ? '/' : ''}">up</a></p>` : '';
  const body = Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><title>${html(here)}</title></head><body><h1>${html(here)}</h1>${back}<table>${rows.join('')}</table></body></html>`);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'x-content-type-options': 'nosniff' });
  res.end(body);
}

export async function share(req, res, pathname) {
  if (req.method !== 'GET') throw new HttpError(405, 'method_not_allowed', 'method not allowed');
  const { names, target } = locate(pathname);
  const info = await stat(target).catch(() => null);
  if (info?.isDirectory()) return folderPage(res, names, target);
  if (info?.isFile()) return download(req, res, target, info.size);
  throw NOT_FOUND();
}
