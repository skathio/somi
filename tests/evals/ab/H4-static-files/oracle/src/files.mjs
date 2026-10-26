// SOMI-CANARY-H4-9b3f2a61d07e4c58
// Downloads and listing pages for the shared folder: GET /files/<path>.
import { createReadStream, lstatSync } from 'node:fs';
import { extname, join } from 'node:path';
import { HttpError } from './http.mjs';
import { SHARED_DIR, listFolder } from './store.mjs';

const TYPES = {
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
};
const GENERIC = 'application/octet-stream';
// Markup a browser would run on our origin: it is saved, never shown.
const ACTIVE = new Set(['.html', '.svg']);

// One path segment, decoded. A segment that names no entry of a folder is refused, so a path cannot leave the shared folder.
function segment(raw) {
  let name;
  try { name = decodeURIComponent(raw); } catch { throw new HttpError(400, 'invalid_path', 'malformed path'); }
  if (name === '.' || name === '..' || /[/\\\0]/.test(name)) throw new HttpError(400, 'invalid_path', 'invalid path');
  return name;
}

// The requested byte range as { start, end }, null when there is none to honour, or 'unsatisfiable'.
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  const [, first, last] = m;
  if (first === '') {
    const n = Number(last);
    return n === 0 || size === 0 ? 'unsatisfiable' : { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(first);
  if (last !== '' && Number(last) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end: last === '' ? size - 1 : Math.min(Number(last), size - 1) };
}

function sendFile(req, res, abs, size) {
  const ext = extname(abs).toLowerCase();
  const range = parseRange(req.headers.range, size);
  if (range === 'unsatisfiable') throw new HttpError(416, 'range_not_satisfiable', 'range not satisfiable', { 'content-range': `bytes */${size}` });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const headers = { 'content-type': TYPES[ext] ?? GENERIC, 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' };
  if (ACTIVE.has(ext)) headers['content-disposition'] = 'attachment';
  if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(range ? 206 : 200, headers);
  if (size === 0) return res.end();
  const stream = createReadStream(abs, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const hrefOf = (names, dir) => `/files/${names.map(encodeURIComponent).join('/')}${dir && names.length ? '/' : ''}`;

function sendListing(res, names, abs) {
  const rows = listFolder(abs).map((e) => {
    const link = `<a href="${hrefOf([...names, e.name], e.type === 'dir')}">${escapeHtml(e.name)}${e.type === 'dir' ? '/' : ''}</a>`;
    return `<li>${link}${e.type === 'file' ? ` <span>${e.size} bytes</span>` : ''}</li>`;
  });
  const where = escapeHtml(`/files/${names.join('/')}${names.length ? '/' : ''}`);
  const up = names.length ? `<p><a href="${hrefOf(names.slice(0, -1), true)}">Parent folder</a></p>` : '';
  const page = Buffer.from(`<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${where}</title></head>\n<body><h1>${where}</h1>${up}\n<ul>\n${rows.join('\n')}\n</ul></body></html>\n`, 'utf8');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': page.length, 'x-content-type-options': 'nosniff' });
  res.end(page);
}

export function filesHandler(req, res, { rest }) {
  const names = rest.map(segment);
  const abs = join(SHARED_DIR, ...names);
  let st;
  try { st = lstatSync(abs); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') throw new HttpError(404, 'not_found', 'no such file or folder');
    throw e;
  }
  if (st.isDirectory()) return sendListing(res, names, abs);
  if (st.isFile()) return sendFile(req, res, abs, st.size);
  throw new HttpError(404, 'not_found', 'no such file or folder');
}
