// Scope manifest (FR-8c, FR-39): what changed in a draw's workspace, and is it inside the declared scope?
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
//   ASCII through esc (bytes as %XX; scopeVerdict escapes again): show it only as given, never raw.
//   Guarantees: no link is followed and no special file is opened. Does NOT guarantee: (1) a hard link to an
//   outside file is a regular file to lstat, so only the container boundary stops it; (2) a concurrent writer
//   can swap a directory for a link after it was checked (each directory is re-checked after listing and the
//   inode check narrows the rest), so the draw must have stopped; (3) symlinked parents of root are followed;
//   (4) where O_NOFOLLOW is undefined only the inode check catches a swapped file; (5) modes, empty
//   directories and timestamps are not in the manifest. The container must: start the walk only after every
//   process in its cgroup is gone (O_NOFOLLOW covers the last component only); mount the workspace nodev; map
//   uids (no host-visible setuid root); never run git or hooks on the after-workspace (.git and .somi are
//   ignored by design).
//
// scopeVerdict({before, after, declared}) -> {verdict: 'in-scope' | 'out-of-scope', reason, path?}, or null.
//   declared = {source: {files: [path], dirs: [path]}, testDir: path, rootFiles: [name]}, all repo-relative.
//   A path is 1..1024 bytes, '/'-separated, no empty, '.' or '..' segment, no leading or trailing '/', the name
//   rule per segment; anything else is null (never normalised). A file entry covers exactly that path; a dir
//   entry and testDir cover their subtree only; rootFiles are single-segment names; the subtree of `.somi` is
//   always tolerated (the entry `.somi` itself is not). A null result is a failure, never a pass. Matching is by exact bytes: `src` does not cover
//   `SRC/x` or `src2/x`. Changed = added, removed or modified; the first changed path (sorted) outside the
//   scope names the failure. A null or refused manifest on either side is out-of-scope. Source is non-empty.

import fs from 'node:fs';
import { createHash } from 'node:crypto';

export const MAX_ENTRIES = 20000;
export const MAX_DEPTH = 32;
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_NAME_BYTES = 255;
const MAX_PATH_BYTES = 1024;
const MAX_LIST = 1024;
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f\\\p{Cf}\p{Zl}\p{Zp}]/u;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const HEX = /^[0-9a-f]{64}$/;
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const byBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
// Printable ASCII only, so a hostile name can never inject a control character into a reason.
const esc = (v) => [...(Buffer.isBuffer(v) ? v : Buffer.from(String(v)))].map((b) => (b >= 0x20 && b < 0x7f && b !== 0x25 && b !== 0x5c ? String.fromCharCode(b) : `%${b.toString(16).padStart(2, '0').toUpperCase()}`)).join('');
class Refusal { constructor(reason, path) { this.reason = reason; this.path = path; } }
const stop = (reason, path) => { throw new Refusal(reason, path); };

function validName(s) {
  return typeof s === 'string' && s !== '' && s !== '.' && s !== '..' && Buffer.byteLength(s) <= MAX_NAME_BYTES
    && !BAD_CHARS.test(s) && !LONE_SURROGATE.test(s) && s.normalize('NFC') === s;
}
const validPath = (p) => typeof p === 'string' && Buffer.byteLength(p) <= MAX_PATH_BYTES && p.split('/').every(validName);
const sameKeys = (o, keys) => { const k = Reflect.ownKeys(o); return k.length === keys.length && keys.every((x) => k.includes(x)); };
// Dense plain copy (`length` and each slot read once), or null.
function dense(arr, max = MAX_LIST) {
  if (!Array.isArray(arr)) return null;
  const n = arr.length;
  if (n > max) return null;
  const list = [];
  for (let i = 0; i < n; i++) { if (!Object.hasOwn(arr, i)) return null; list.push(arr[i]); }
  return list;
}
const FS_METHODS = ['lstatSync', 'opendirSync', 'openSync', 'fstatSync', 'readSync', 'closeSync'];

/** `root` -> `{ok: true, files: [[path, sha256]]}`, `{ok: false, reason, path}`, or `null` (malformed argument). */
export function lstatManifest(root, opts) {
  let f;
  try {
    if (typeof root !== 'string' || root === '' || root.includes('\0')) return null;
    root = root.replace(/\/+$/, '') || '/';
    if (opts === undefined) f = fs;
    else {
      if (!isObject(opts) || !sameKeys(opts, ['fs'])) return null;
      f = opts.fs;
    }
    if (!isObject(f) || !FS_METHODS.every((m) => typeof f[m] === 'function') || !isObject(f.constants)) return null;
    f = { ...Object.fromEntries(FS_METHODS.map((m) => [m, f[m].bind(f)])), constants: f.constants };
  } catch { return null; }

  const abs = (rel) => (rel === '' ? root : `${root}/${rel}`);
  const io = (rel, fn) => { try { return fn(); } catch (e) { if (e instanceof Refusal) throw e; return stop('io-error', rel || '.'); } };
  const lstat = (rel) => io(rel, () => f.lstatSync(abs(rel), { bigint: true }));
  const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
  const files = [];
  let entries = 0;
  let total = 0; let rootDev;

  function walk(dirRel, depth, dirSt) {
    if (depth > MAX_DEPTH) stop('too-deep', dirRel);
    const names = [];
    io(dirRel, () => {
      const dir = f.opendirSync(abs(dirRel), { encoding: 'buffer' });
      try {
        for (let e = dir.readSync(); e !== null; e = dir.readSync()) {
          names.push(Buffer.from(e.name));
          if (entries + names.length > MAX_ENTRIES) stop('too-many-entries', dirRel || '.');
        }
      } finally { dir.closeSync(); }
    });
    // A directory swapped for a link while it was listed is not the directory that was checked.
    if (!same(lstat(dirRel), dirSt)) stop('changed', dirRel || '.');
    names.sort(Buffer.compare);
    if (names.some((n, i) => i > 0 && n.equals(names[i - 1]))) stop('duplicate', dirRel || '.');
    for (const raw of names) {
      let name;
      try { name = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { name = null; }
      const shown = dirRel === '' ? raw : Buffer.concat([Buffer.from(`${dirRel}/`), raw]);
      if (name === null || !validName(name)) stop('bad-name', shown);
      const rel = dirRel === '' ? name : `${dirRel}/${name}`;
      if (Buffer.byteLength(rel) > MAX_PATH_BYTES) stop('path-too-long', shown);
      if (++entries > MAX_ENTRIES) stop('too-many-entries', rel);
      const st = lstat(rel);
      if (st.isSymbolicLink()) stop('symlink', rel);
      if (dirRel === '' && name === '.git') {
        if (!st.isDirectory() && !st.isFile()) stop('special-file', rel);
      } else if (st.isDirectory()) { if (st.dev !== rootDev) stop('mount-point', rel); walk(rel, depth + 1, st); }
      else if (st.isFile()) {
        if ((st.mode & 0o6002n) !== 0n) stop('unsafe-mode', rel);
        if (st.size > BigInt(MAX_FILE_BYTES)) stop('file-too-large', rel);
        total += Number(st.size);
        if (total > MAX_TOTAL_BYTES) stop('too-large', rel);
        files.push([rel, st]);
      } else stop('special-file', rel);
    }
  }

  function hash(rel, st) {
    const c = f.constants;
    let fd = null;
    try {
      fd = f.openSync(abs(rel), c.O_RDONLY | (c.O_NOFOLLOW ?? 0) | (c.O_NONBLOCK ?? 0));
      const s = f.fstatSync(fd, { bigint: true });
      if (!s.isFile() || !same(s, st) || s.size !== st.size || s.ctimeNs !== st.ctimeNs) stop('changed', rel);
      const size = Number(st.size);
      const h = createHash('sha256');
      const buf = Buffer.allocUnsafe(Math.min(size + 1, 65536));
      let got = 0;
      for (let n = f.readSync(fd, buf, 0, buf.length, null); n > 0; n = f.readSync(fd, buf, 0, buf.length, null)) {
        got += n;
        if (got > size) stop('changed', rel);
        h.update(buf.subarray(0, n));
      }
      if (got !== size) stop('changed', rel);
      return h.digest('hex');
    } catch (e) {
      if (e instanceof Refusal) throw e;
      return stop(e?.code === 'ELOOP' ? 'symlink' : 'io-error', rel);
    } finally {
      if (fd !== null) try { f.closeSync(fd); } catch { /* a read-only handle: nothing to undo */ }
    }
  }
  try {
    const rootSt = lstat('');
    if (rootSt.isSymbolicLink()) stop('symlink', '.');
    if (!rootSt.isDirectory()) stop('not-a-directory', '.');
    rootDev = rootSt.dev;
    walk('', 0, rootSt);
    const out = files.map(([rel, st]) => [rel, hash(rel, st)]);
    return { ok: true, files: out.sort((a, b) => byBytes(a[0], b[0])) };
  } catch (e) {
    return e instanceof Refusal ? { ok: false, reason: e.reason, path: esc(e.path) } : { ok: false, reason: 'io-error', path: '.' };
  }
}

// A manifest as scopeVerdict sees it: {map} to compare, {fail, path?} when it is null or refused (never
// in scope), or null when it is not a manifest at all.
function readManifest(m, side) {
  if (m === null) return { fail: `${side} manifest unavailable` };
  if (!isObject(m)) return null;
  if (m.ok === false) {
    if (!sameKeys(m, ['ok', 'reason', 'path'])) return null;
    const { reason, path } = m;
    return typeof reason === 'string' && typeof path === 'string' ? { fail: `${side} manifest refused: ${esc(reason)} at ${esc(path)}`, path: esc(path) } : null;
  }
  if (m.ok !== true || !sameKeys(m, ['ok', 'files'])) return null;
  const list = dense(m.files, MAX_ENTRIES);
  if (!list) return null;
  const map = new Map();
  for (const entry of list) {
    const pair = dense(entry);
    if (!pair || pair.length !== 2 || !validPath(pair[0]) || typeof pair[1] !== 'string' || !HEX.test(pair[1]) || map.has(pair[0])) return null;
    map.set(pair[0], pair[1]);
  }
  return { map };
}

function readDeclared(d) {
  if (!isObject(d) || !sameKeys(d, ['source', 'testDir', 'rootFiles'])) return null;
  const { source, testDir, rootFiles } = d;
  if (!isObject(source) || !sameKeys(source, ['files', 'dirs'])) return null;
  const srcFiles = dense(source.files);
  const srcDirs = dense(source.dirs);
  const roots = dense(rootFiles);
  if (!srcFiles || !srcDirs || !roots || srcFiles.length + srcDirs.length === 0) return null;
  if (![...srcFiles, ...srcDirs, ...roots, testDir].every(validPath) || roots.some((p) => p.includes('/'))) return null;
  return { exact: new Set([...srcFiles, ...roots]), dirs: [...srcDirs, testDir, '.somi'] };
}

/** `{before, after, declared}` -> `{verdict, reason, path?}`, or `null` for a malformed argument. */
export function scopeVerdict(args) {
  try {
    if (!isObject(args) || !sameKeys(args, ['before', 'after', 'declared'])) return null;
    const { before, after, declared } = args;
    const decl = readDeclared(declared);
    const b = readManifest(before, 'before');
    const a = readManifest(after, 'after');
    if (!decl || !b || !a) return null;
    for (const m of [b, a]) if (m.fail) return { verdict: 'out-of-scope', reason: m.fail, ...(m.path === undefined ? {} : { path: m.path }) };
    const changed = [...new Set([...b.map.keys(), ...a.map.keys()])].filter((p) => b.map.get(p) !== a.map.get(p)).sort(byBytes);
    const bad = changed.find((p) => !decl.exact.has(p) && !decl.dirs.some((d) => p.startsWith(`${d}/`)));
    if (bad !== undefined) return { verdict: 'out-of-scope', reason: `out of scope: ${esc(bad)} changed`, path: esc(bad) };
    return { verdict: 'in-scope', reason: `${changed.length} changed path(s), all within the declared scope` };
  } catch { return null; }
}
