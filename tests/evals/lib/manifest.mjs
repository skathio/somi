// Scope manifest (FR-8c, FR-39): what changed in a draw's workspace. Whether that is inside the declared scope is scope.mjs.
// Read-only: no child process, no network, nothing written, no candidate file parsed or run (only hashed).
// The directory is hostile data (a bypassPermissions agent wrote it): every doubt is a refusal.
//
// lstatManifest(root, {fs}) -> {ok: true, files: [[path, sha256], ...]}, {ok: false, reason, path} naming the
// first offender in walk order (per directory, by UTF-8 bytes), or null for a malformed argument. `fs` is for
// tests only (production never passes it); trailing slashes on root are dropped before any use.
//   Phase 1 walks with lstat only and opens no file: a symlink anywhere (root included) is refused, as is
//   anything neither regular nor a directory (FIFO, socket, device: never opened, so nothing can block). Only
//   the root-level `.git` (a directory or a file) is skipped; a nested `.git` is walked like any entry.
//   Phase 2 hashes each file through ONE fd: open O_RDONLY|O_NOFOLLOW|O_NONBLOCK, then fstat must be a regular
//   file with the lstat's dev, ino and size, and the bytes read must equal that size (growth or shrinkage is
//   refused). A mismatch is a refusal, never a retry. Output is sorted by path bytes (creation-order free).
//   Caps (refused, never truncated): entries, depth, per-file bytes, total bytes, name and path length.
//   Name rule: valid UTF-8, NFC (a non-NFC task file name is a scope fail: use NFC names), 1..255 bytes, no
//   C0/C1 control, format (bidi, zero-width, BOM) or line-separator character, no backslash; case variants stay
//   distinct. A file with setuid, setgid or world-writable bits (unsafe-mode), a directory on another device than
//   the root (mount-point) and a repeated name are refused. Every `path` and reason is display text, printable
//   ASCII through esc (bytes as %XX; the scope verdict escapes again): show it only as given, never raw.
//   Guarantees: no link is followed and no special file is opened. Does NOT guarantee: (1) a hard link to an
//   outside file is a regular file to lstat, so only the container boundary stops it; (2) a concurrent writer
//   can swap a directory for a link after it was checked (each directory is re-checked after listing and the
//   inode check narrows the rest), so the draw must have stopped; (3) symlinked parents of root are followed;
//   (4) where O_NOFOLLOW is undefined only the inode check catches a swapped file; (5) modes, empty
//   directories and timestamps are not in the manifest. The container must: start the walk only after every
//   process in its cgroup is gone (O_NOFOLLOW covers the last component only); mount the workspace nodev; map
//   uids (no host-visible setuid root); never run git or hooks on the after-workspace (.git and .somi are
//   ignored by design).


import fs from 'node:fs';
import { createHash } from 'node:crypto';

export const MAX_ENTRIES = 20000;
export const MAX_DEPTH = 32;
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_NAME_BYTES = 255;
const MAX_PATH_BYTES = 1024;
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f\\\p{Cf}\p{Zl}\p{Zp}]/u;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
export const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
export const byBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
// Printable ASCII only, so a hostile name can never inject a control character into a reason.
export const esc = (v) => [...(Buffer.isBuffer(v) ? v : Buffer.from(String(v)))].map((b) => (b >= 0x20 && b < 0x7f && b !== 0x25 && b !== 0x5c ? String.fromCharCode(b) : `%${b.toString(16).padStart(2, '0').toUpperCase()}`)).join('');
class Refusal { constructor(reason, path) { this.reason = reason; this.path = path; } }
const stop = (reason, path) => { throw new Refusal(reason, path); };

function validName(s) {
  return typeof s === 'string' && s !== '' && s !== '.' && s !== '..' && Buffer.byteLength(s) <= MAX_NAME_BYTES
    && !BAD_CHARS.test(s) && !LONE_SURROGATE.test(s) && s.normalize('NFC') === s;
}
export const validPath = (p) => typeof p === 'string' && Buffer.byteLength(p) <= MAX_PATH_BYTES && p.split('/').every(validName);
export const sameKeys = (o, keys) => { const k = Reflect.ownKeys(o); return k.length === keys.length && keys.every((x) => k.includes(x)); };
const FS_METHODS = ['lstatSync', 'opendirSync', 'openSync', 'fstatSync', 'readSync', 'closeSync'];

// The root without its trailing slashes and the fs to read it with (bound copies of the methods used), or null for a malformed argument.
function fsFrom(opts) {
  const f = opts === undefined ? fs : isObject(opts) && sameKeys(opts, ['fs']) ? opts.fs : null;
  return isObject(f) && FS_METHODS.every((m) => typeof f[m] === 'function') && isObject(f.constants) ? f : null;
}
function readArgs(root, opts) {
  try {
    if (typeof root !== 'string' || root === '' || root.includes('\0')) return null;
    const f = fsFrom(opts);
    return f && { root: root.replace(/\/+$/, '') || '/', f: { ...Object.fromEntries(FS_METHODS.map((m) => [m, f[m].bind(f)])), constants: f.constants } };
  } catch { return null; }
}

// The walk's state is one context: the root, the fs, the files found so far and the running entry and byte counts.
const abs = (ctx, rel) => (rel === '' ? ctx.root : `${ctx.root}/${rel}`);
const here = (rel) => rel || '.';
const io = (rel, fn) => { try { return fn(); } catch (e) { if (e instanceof Refusal) throw e; return stop('io-error', here(rel)); } };
const lstat = (ctx, rel) => io(rel, () => ctx.f.lstatSync(abs(ctx, rel), { bigint: true }));
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const decoded = (raw) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { return null; } };

// One directory's names, sorted by bytes. Refused when there are too many, when it was swapped while it was listed, or when a name repeats.
function namesIn(ctx, dirRel, dirSt) {
  const names = [];
  io(dirRel, () => {
    const dir = ctx.f.opendirSync(abs(ctx, dirRel), { encoding: 'buffer' });
    try {
      for (let e = dir.readSync(); e !== null; e = dir.readSync()) {
        names.push(Buffer.from(e.name));
        if (ctx.entries + names.length > MAX_ENTRIES) stop('too-many-entries', here(dirRel));
      }
    } finally { dir.closeSync(); }
  });
  // A directory swapped for a link while it was listed is not the directory that was checked.
  if (!same(lstat(ctx, dirRel), dirSt)) stop('changed', here(dirRel));
  names.sort(Buffer.compare);
  if (names.some((n, i) => i > 0 && n.equals(names[i - 1]))) stop('duplicate', here(dirRel));
  return names;
}

// An entry's name and path, once the name passes the name rule and the path its length and the entry cap.
function entryOf(ctx, dirRel, raw) {
  const name = decoded(raw);
  const shown = dirRel === '' ? raw : Buffer.concat([Buffer.from(`${dirRel}/`), raw]);
  if (name === null || !validName(name)) stop('bad-name', shown);
  const rel = dirRel === '' ? name : `${dirRel}/${name}`;
  if (Buffer.byteLength(rel) > MAX_PATH_BYTES) stop('path-too-long', shown);
  if (++ctx.entries > MAX_ENTRIES) stop('too-many-entries', rel);
  return { name, rel };
}

function addFile(ctx, rel, st) {
  if ((st.mode & 0o6002n) !== 0n) stop('unsafe-mode', rel);
  if (st.size > BigInt(MAX_FILE_BYTES)) stop('file-too-large', rel);
  ctx.total += Number(st.size);
  if (ctx.total > MAX_TOTAL_BYTES) stop('too-large', rel);
  ctx.files.push([rel, st]);
}

// One entry: a link is refused, the root-level .git (a directory or a file) is skipped, a directory is walked, a file is listed.
function visit(ctx, { dirRel, name, rel, depth }) {
  const st = lstat(ctx, rel);
  if (st.isSymbolicLink()) stop('symlink', rel);
  if (dirRel === '' && name === '.git') {
    if (!st.isDirectory() && !st.isFile()) stop('special-file', rel);
  } else take(ctx, { rel, depth }, st);
}
function take(ctx, { rel, depth }, st) {
  if (!st.isDirectory()) return st.isFile() ? addFile(ctx, rel, st) : stop('special-file', rel);
  if (st.dev !== ctx.rootDev) stop('mount-point', rel);
  return walk(ctx, rel, depth + 1, st);
}

function walk(ctx, dirRel, depth, dirSt) {
  if (depth > MAX_DEPTH) stop('too-deep', dirRel);
  for (const raw of namesIn(ctx, dirRel, dirSt)) visit(ctx, { dirRel, ...entryOf(ctx, dirRel, raw), depth });
}

// The hash of what one descriptor holds, which must be exactly `size` bytes: growth or shrinkage is a change.
function digestOf(ctx, fd, size, rel) {
  const h = createHash('sha256');
  const buf = Buffer.allocUnsafe(Math.min(size + 1, 65536));
  let got = 0;
  for (let n = ctx.f.readSync(fd, buf, 0, buf.length, null); n > 0; n = ctx.f.readSync(fd, buf, 0, buf.length, null)) {
    got += n;
    if (got > size) stop('changed', rel);
    h.update(buf.subarray(0, n));
  }
  if (got !== size) stop('changed', rel);
  return h.digest('hex');
}

const refusalFor = (e, rel) => { if (e instanceof Refusal) throw e; return stop(e?.code === 'ELOOP' ? 'symlink' : 'io-error', rel); };
const closeQuietly = (f, fd) => { try { f.closeSync(fd); } catch { /* a read-only handle: nothing to undo */ } };
const unchanged = (s, st) => s.isFile() && same(s, st) && s.size === st.size && s.ctimeNs === st.ctimeNs;
// Phase 2: one file through one descriptor, which must still be the regular file the walk saw.
function hashFile(ctx, rel, st) {
  const c = ctx.f.constants;
  let fd = null;
  try {
    fd = ctx.f.openSync(abs(ctx, rel), c.O_RDONLY | (c.O_NOFOLLOW ?? 0) | (c.O_NONBLOCK ?? 0));
    if (!unchanged(ctx.f.fstatSync(fd, { bigint: true }), st)) stop('changed', rel);
    return digestOf(ctx, fd, Number(st.size), rel);
  } catch (e) {
    return refusalFor(e, rel);
  } finally {
    if (fd !== null) closeQuietly(ctx.f, fd);
  }
}

/** `root` -> `{ok: true, files: [[path, sha256]]}`, `{ok: false, reason, path}`, or `null` (malformed argument). */
export function lstatManifest(root, opts) {
  const args = readArgs(root, opts);
  if (!args) return null;
  const ctx = { ...args, files: [], entries: 0, total: 0, rootDev: undefined };
  try {
    const rootSt = lstat(ctx, '');
    if (rootSt.isSymbolicLink()) stop('symlink', '.');
    if (!rootSt.isDirectory()) stop('not-a-directory', '.');
    ctx.rootDev = rootSt.dev;
    walk(ctx, '', 0, rootSt);
    const out = ctx.files.map(([rel, st]) => [rel, hashFile(ctx, rel, st)]);
    return { ok: true, files: out.sort((a, b) => byBytes(a[0], b[0])) };
  } catch (e) {
    return e instanceof Refusal ? { ok: false, reason: e.reason, path: esc(e.path) } : { ok: false, reason: 'io-error', path: '.' };
  }
}
