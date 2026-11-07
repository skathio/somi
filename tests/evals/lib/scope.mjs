// Scope verdict (FR-8c, FR-39): is everything that changed between two manifests inside the declared scope? Read-only and pure: it
// compares two lstatManifest results and a declared scope, and touches no file.
//
// scopeVerdict({before, after, declared}) -> {verdict: 'in-scope' | 'out-of-scope', reason, path?}, or null.
//   declared = {source: {files: [path], dirs: [path]}, testDir: path, rootFiles: [name]}, all repo-relative.
//   A path is 1..1024 bytes, '/'-separated, no empty, '.' or '..' segment, no leading or trailing '/', the name
//   rule per segment; anything else is null (never normalised). A file entry covers exactly that path; a dir
//   entry and testDir cover their subtree only; rootFiles are single-segment names; the subtree of `.somi` is
//   always tolerated (the entry `.somi` itself is not). A null result is a failure, never a pass. Matching is by exact bytes: `src` does not cover
//   `SRC/x` or `src2/x`. Changed = added, removed or modified; the first changed path (sorted) outside the
//   scope names the failure. A null or refused manifest on either side is out-of-scope. Source is non-empty.

import { MAX_ENTRIES, byBytes, esc, isObject, sameKeys, validPath } from './manifest.mjs';

const MAX_LIST = 1024;
const HEX = /^[0-9a-f]{64}$/;
// Dense plain copy (`length` and each slot read once), or null.
function dense(arr, max = MAX_LIST) {
  if (!Array.isArray(arr)) return null;
  const n = arr.length;
  if (n > max) return null;
  const list = [];
  for (let i = 0; i < n; i++) { if (!Object.hasOwn(arr, i)) return null; list.push(arr[i]); }
  return list;
}

const validEntry = (pair, map) => Boolean(pair) && pair.length === 2 && validPath(pair[0]) && typeof pair[1] === 'string' && HEX.test(pair[1]) && !map.has(pair[0]);
function refusedManifest(m, side) {
  if (!sameKeys(m, ['ok', 'reason', 'path'])) return null;
  const { reason, path } = m;
  return typeof reason === 'string' && typeof path === 'string' ? { fail: `${side} manifest refused: ${esc(reason)} at ${esc(path)}`, path: esc(path) } : null;
}
function fileMap(m) {
  if (m.ok !== true || !sameKeys(m, ['ok', 'files'])) return null;
  const list = dense(m.files, MAX_ENTRIES);
  if (!list) return null;
  const map = new Map();
  for (const entry of list) {
    const pair = dense(entry);
    if (!validEntry(pair, map)) return null;
    map.set(pair[0], pair[1]);
  }
  return { map };
}
// A manifest as scopeVerdict sees it: {map} to compare, {fail, path?} when it is null or refused (never
// in scope), or null when it is not a manifest at all.
function readManifest(m, side) {
  if (m === null) return { fail: `${side} manifest unavailable` };
  if (!isObject(m)) return null;
  return m.ok === false ? refusedManifest(m, side) : fileMap(m);
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

const covered = (decl, p) => decl.exact.has(p) || decl.dirs.some((d) => p.startsWith(`${d}/`));
// Changed = added, removed or modified; the first changed path, by bytes, outside the scope names the failure.
function compare(decl, b, a) {
  const changed = [...new Set([...b.map.keys(), ...a.map.keys()])].filter((p) => b.map.get(p) !== a.map.get(p)).sort(byBytes);
  const bad = changed.find((p) => !covered(decl, p));
  if (bad !== undefined) return { verdict: 'out-of-scope', reason: `out of scope: ${esc(bad)} changed`, path: esc(bad) };
  return { verdict: 'in-scope', reason: `${changed.length} changed path(s), all within the declared scope` };
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
    const refused = [b, a].find((m) => m.fail);
    return refused ? { verdict: 'out-of-scope', reason: refused.fail, ...(refused.path === undefined ? {} : { path: refused.path }) } : compare(decl, b, a);
  } catch { return null; }
}
