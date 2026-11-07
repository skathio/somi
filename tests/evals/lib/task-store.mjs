// Task material (FR-13 inputs): the shape of a task's `task.json` and the immutable hash of a task directory.
// Read-only: no child process, no network, nothing written, no task file run (only parsed as JSON or hashed).
// The task directory is data a reviewer committed, but it is read as hostile: every doubt is a refusal.
//
// validateTaskJson(obj) -> {ok: true, task} or {ok: false, reason}; the reason names the field. `task` is a deep-
// frozen plain copy; the input is never kept (each field is read once, from own enumerable data properties only,
// so a getter, a Proxy that answers differently twice, a sparse array or an inherited key changes nothing).
//   schema_version  exactly 1.
//   statements      array of 1..64 distinct strings, the numbered statement lines (line n is index n-1); each is
//                   1..512 UTF-16 units with no control, format (bidi, zero-width), surrogate, private-use or
//                   line-separator character, blank-looking filler, or leading or trailing whitespace.
//   runner          'node-test' or 'playwright'.
//   canary          string matching [A-Za-z0-9_-]{16,64}.
//   source          array of 1..64 distinct declared source paths. A trailing '/' marks a directory (its subtree);
//                   no trailing '/' marks a single file.
//   test_dir        one directory path, no trailing '/'.
//   root_files      array of 0..64 distinct tolerated root file names (single segment).
//   brief           the fixed brief: 1..8192 UTF-16 units, the same character rule as statements except that
//                   newline and tab are allowed, and not only whitespace.
//   turns           optional: an array of 1..16 distinct follow-up messages, sent in order after the first turn ends, the
//                   same character rule as statements. They let a task test what a session keeps across a conversation.
//   Every other key is refused (the reason is `task.json: unknown key <key>`, the key escaped and cut to 64
//   bytes). `.git` and `.somi` and their subpaths cannot be declared. A path is relative and obeys the manifest path rule (no leading '/', no empty, '.'
//   or '..' segment, no backslash, NFC, the manifest name rule per segment).
//
// task.json holds the canary, so the runner must take `brief` out of it and
// never mount task.json where the candidate can read it (the task standard wins over a candidate-visible
// fixture reading of the brief). validateTaskJson returns `{ok: false, reason}`, not null, so the field is named.
//
// declaredScope(task) -> the `declared` argument of scopeVerdict (scope.mjs): {source: {files, dirs}, testDir, rootFiles}.
//
// taskHash(dir, {fs}) -> {ok: true, hash, task} or {ok: false, reason}; `fs` is for tests only. The directory must
// hold a valid `task.json` at its root and pass lstatManifest (a link, special file, bad name or cap anywhere is
// a refusal). It is also refused for a root `.git` entry, a file with an execute bit and an empty directory
// (none of which the manifest records), and for a tree that changed between the walk and these checks. The
// encoding below is unchanged by those refusals: they only remove inputs. Frozen format:
//   hash = sha256 over the bytes  'somi-task-v1' NUL  then, for each manifest entry in the manifest's order (sorted
//          by path UTF-8 bytes, so creation order does not matter),  path-utf8 NUL file-sha256-lowercase-hex NUL.
// A path has no NUL (the name rule refuses control characters) and a file hash is 64 hex digits, so two different
// manifests never share bytes. `task.json` is in the manifest and so in the hash. Every changed byte, added,
// removed or renamed file changes the hash. Not in the hash: modes, timestamps (the refusals above bound them).
//   Changing this encoding, the prefix or the manifest rules changes every task hash: bump the prefix version.
//
// canaryCheck(dir, {fs}) -> {ok: true, hash} or {ok: false, reason}; `hash` is taskHash's value over the same
// manifest. The directory is checked as taskHash loads it (the canary is the validated one from the same
// task.json, never a caller's). Every file under hidden/, oracle/ and oracle2/ must contain the canary and each
// of those three must hold a file (a vacuous pass is refused). Nothing candidate-visible may contain it: no file
// under fixture/, no statement, not the brief, and no declared source, test_dir or root_files path (the candidate
// creates those, so every draw would trip it). No path of any file may contain it either (so a directory name too).
// The exact root task.json is the only file skipped. A task without a fixture/ directory is accepted (greenfield).
// Layout: only task.json and fixture/, hidden/, oracle/, oracle2/ are allowed; any other top-level entry is
// refused. That includes nop/ and mutants/: the task standard gives no location for them, so canaryCheck refuses
// them today and they join the layout with a canary rule when the first real task is authored. Bytes are searched,
// never decoded (invalid UTF-8 cannot hide the canary), case-sensitively, over the whole file (no chunk boundary),
// each file read once under the size and hash discipline of task.json (a file over the manifest cap is refused).

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { MAX_FILE_BYTES, esc, lstatManifest, validPath } from './manifest.mjs';

const PREFIX = 'somi-task-v1\0';
const MAX_LIST = 64;
const MAX_TEXT = 512;
const MAX_BRIEF = 8192;
const MAX_JSON_BYTES = 256 * 1024;
const HIDDEN_DIRS = ['hidden', 'oracle', 'oracle2'];
const LAYOUT = ['fixture', ...HIDDEN_DIRS];
const KEYS = ['schema_version', 'statements', 'runner', 'canary', 'source', 'test_dir', 'root_files', 'brief'];
const OPTIONAL = ['turns'];
const RUNNERS = ['node-test', 'playwright'];
const CANARY = /^[A-Za-z0-9_-]{16,64}$/;
const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\u2028\u2029\u3164\u115f\u1160\uffa0\u2800]/u;
const EDGE_SPACE = /^[\s\p{Z}]|[\s\p{Z}]$/u;
const refuse = (field, why) => ({ ok: false, reason: `${field}: ${why}` });
class Bad extends Error { constructor(field, why) { super(why); this.field = field; } }
const bad = (field, why) => { throw new Bad(field, why); };
const isText = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT && !UNSAFE.test(v) && !EDGE_SPACE.test(v);
const isBrief = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_BRIEF && !UNSAFE.test(v.replace(/[\n\t]/g, '')) && v.trim() !== '';

// Own enumerable data property of `o` (a getter or accessor is refused, never called).
function own(o, key, field) {
  const d = Reflect.getOwnPropertyDescriptor(o, key);
  if (!d || !('value' in d) || !d.enumerable) bad(field, 'not a plain data property');
  return d.value;
}
function plainObject(v, field) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(field, 'not an object');
  const proto = Reflect.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) bad(field, 'not a plain object');
  return v;
}
// Dense plain copy of an array of `min..MAX_LIST` items (length and each slot read once).
function list(v, field, min) {
  if (!Array.isArray(v)) bad(field, 'not an array');
  const n = v.length;
  if (n < min || n > MAX_LIST) bad(field, `needs ${min}..${MAX_LIST} entries`);
  if (Reflect.ownKeys(v).length !== n + 1) bad(field, 'not a dense array');
  return Array.from({ length: n }, (_, i) => own(v, String(i), field));
}
function distinct(items, field) {
  if (new Set(items).size !== items.length) bad(field, 'duplicate entry');
  return items;
}
// `.git` and `.somi` are never task paths: the first is skipped by the walk, the second is always tolerated.
const reserved = (p) => /^\.(git|somi)(\/|$)/.test(p);
const dirPath = (p, field) => {
  if (typeof p !== 'string' || !validPath(p)) bad(field, 'not a valid relative path');
  if (reserved(p)) bad(field, '.git and .somi cannot be declared');
  return p;
};

// Every required key, each read once as a plain data property; an unknown key or a missing one is refused.
function rawFields(obj) {
  plainObject(obj, 'task.json');
  const keys = Reflect.ownKeys(obj);
  const extra = keys.find((k) => !KEYS.includes(k) && !OPTIONAL.includes(k));
  // The key is hostile text: bounded before it is escaped, so the reason stays printable ASCII and short.
  if (extra !== undefined) bad('task.json', `unknown key ${esc(String(extra).slice(0, 64)).slice(0, 64)}`);
  const raw = {};
  for (const k of KEYS) {
    if (!keys.includes(k)) bad(k, 'missing');
    raw[k] = own(obj, k, k);
  }
  return { raw, keys };
}

const textLines = (v, field, why) => {
  const lines = distinct(list(v, field, 1), field);
  if (!lines.every(isText)) bad(field, why);
  return lines;
};

// The declared scope: source entries (a trailing '/' marks a directory), the test directory and the root files.
function readScope(raw) {
  const source = list(raw.source, 'source', 1);
  // "src" and "src/" name the same path, so they are duplicates.
  const bare = source.map((p) => dirPath(typeof p === 'string' && p.endsWith('/') ? p.slice(0, -1) : p, 'source'));
  distinct(bare, 'source');
  const testDir = dirPath(raw.test_dir, 'test_dir');
  const rootFiles = distinct(list(raw.root_files, 'root_files', 0), 'root_files');
  if (!rootFiles.every((p) => typeof p === 'string' && validPath(p) && !p.includes('/') && !reserved(p))) bad('root_files', 'a name is not a single valid path segment');
  return { source, test_dir: testDir, root_files: rootFiles };
}

function readTurns(obj, keys) {
  const turns = keys.includes('turns') ? distinct(list(own(obj, 'turns', 'turns'), 'turns', 1), 'turns') : [];
  if (turns.length > 16 || !turns.every(isText)) bad('turns', 'must be 1..16 lines of plain 1..512-unit text');
  return turns;
}

// The fields are checked in a fixed order, so the first rule a task breaks is the one its refusal names.
function readTask(obj) {
  const { raw, keys } = rawFields(obj);
  if (raw.schema_version !== 1) bad('schema_version', 'must be 1');
  const statements = textLines(raw.statements, 'statements', 'a line is not plain 1..512-unit text');
  if (!RUNNERS.includes(raw.runner)) bad('runner', `must be one of ${RUNNERS.join(', ')}`);
  if (typeof raw.canary !== 'string' || !CANARY.test(raw.canary)) bad('canary', 'must match [A-Za-z0-9_-]{16,64}');
  const scope = readScope(raw);
  if (!isBrief(raw.brief)) bad('brief', 'must be 1..8192 units of plain text');
  const turns = readTurns(obj, keys);
  return { schema_version: 1, statements, runner: raw.runner, canary: raw.canary, ...scope, brief: raw.brief, turns };
}

/** A parsed `task.json` value -> `{ok: true, task}` (deep-frozen plain copy) or `{ok: false, reason}` naming the field. */
export function validateTaskJson(obj) {
  try {
    const t = readTask(obj);
    for (const k of ['statements', 'source', 'root_files', 'turns']) Object.freeze(t[k]);
    return { ok: true, task: Object.freeze(t) };
  } catch (e) {
    return e instanceof Bad ? refuse(e.field, e.message) : refuse('task.json', 'unreadable');
  }
}

/** A validated task -> the `declared` argument of `scopeVerdict`: a source entry ending in '/' is a directory. */
export function declaredScope(task) {
  const dirs = task.source.filter((p) => p.endsWith('/')).map((p) => p.slice(0, -1));
  return { source: { files: task.source.filter((p) => !p.endsWith('/')), dirs }, testDir: task.test_dir, rootFiles: [...task.root_files] };
}

// Bytes of `file` (a regular file of at most `max` bytes, opened without following a link or blocking), or null.
// A swap, growth or short read is not checked here: the caller compares the hash of these bytes to the walk's.
function readSmall(f, file, max = MAX_JSON_BYTES) {
  let fd = null;
  try {
    fd = f.openSync(file, f.constants.O_RDONLY | (f.constants.O_NOFOLLOW ?? 0) | (f.constants.O_NONBLOCK ?? 0));
    const st = f.fstatSync(fd);
    if (!st.isFile() || st.size > max) return null;
    const buf = Buffer.alloc(st.size);
    return buf.subarray(0, f.readSync(fd, buf, 0, buf.length, 0));
  } catch { return null; } finally { if (fd !== null) try { f.closeSync(fd); } catch { /* read-only handle */ } }
}

// The first thing the manifest does not cover that a task must not have, as a reason, or null: a root `.git`, a
// file with an execute bit, an empty directory. Also refuses a file the manifest did not list (changed since).
function strayReason(f, root, listed) {
  const ctx = { f, root, seen: new Set() };
  const r = strayIn(ctx, '');
  return r ?? (ctx.seen.size === listed.size && [...ctx.seen].every((p) => listed.has(p)) ? null : 'changed since it was listed');
}
function strayIn(ctx, rel) {
  const names = ctx.f.readdirSync(rel === '' ? ctx.root : `${ctx.root}/${rel}`);
  if (names.length === 0 && rel !== '') return `empty directory at ${esc(rel)}`;
  for (const name of names) {
    const r = strayEntry(ctx, rel, name);
    if (r) return r;
  }
  return null;
}
function strayEntry(ctx, rel, name) {
  const p = rel === '' ? name : `${rel}/${name}`;
  if (rel === '' && name === '.git') return `root .git entry at ${esc(p)}`;
  const st = ctx.f.lstatSync(`${ctx.root}/${p}`);
  if (st.isDirectory()) return strayIn(ctx, p);
  if (!st.isFile()) return `changed since it was listed at ${esc(p)}`;
  if ((st.mode & 0o111) !== 0) return `execute bit at ${esc(p)}`;
  ctx.seen.add(p);
  return null;
}

// task.json as JSON, read again and checked against the hash the manifest took.
function readTaskJson(f, root, hash) {
  const bytes = readSmall(f, `${root}/task.json`);
  if (bytes === null || createHash('sha256').update(bytes).digest('hex') !== hash) return refuse('task.json', 'unreadable, too large or changed since it was hashed');
  try { return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }; } catch { return refuse('task.json', 'not valid UTF-8 JSON'); }
}

// The shared start of taskHash and canaryCheck: the manifest, the validated task and the injected-or-real fs.
function load(dir, opts) {
  const m = lstatManifest(dir, opts);
  if (m === null) return refuse('dir', 'not a usable directory argument');
  if (!m.ok) return refuse('dir', `manifest refused: ${m.reason} at ${m.path}`);
  const entry = m.files.find((e) => e[0] === 'task.json');
  if (!entry) return refuse('task.json', 'missing');
  const root = dir.replace(/\/+$/, '') || '/';
  const f = opts === undefined ? fs : opts.fs;
  const parsed = readTaskJson(f, root, entry[1]);
  if (!parsed.ok) return parsed;
  const v = validateTaskJson(parsed.value);
  if (!v.ok) return v;
  const stray = strayReason(f, root, new Set(m.files.map((e) => e[0])));
  return stray === null ? { ok: true, m, task: v.task, f, root } : refuse('dir', stray);
}

function digest(files) {
  const h = createHash('sha256').update(PREFIX);
  for (const [p, fileHash] of files) h.update(`${p}\0${fileHash}\0`);
  return h.digest('hex');
}

/** A task directory -> `{ok: true, hash, task}` or `{ok: false, reason}`; the format is in the header. */
export function taskHash(dir, opts) {
  try {
    const l = load(dir, opts);
    if (!l.ok) return l;
    return { ok: true, hash: digest(l.m.files), task: l.task };
  } catch { return refuse('dir', 'unreadable'); }
}

/** A task directory -> `{ok: true}` or `{ok: false, reason}` naming the first offending file; the rules are in the header. */
// The task's own text and declared paths, which a candidate sees, must not hold the canary.
function declaredLeak(task, canary) {
  const declared = [['source', task.source], ['test_dir', [task.test_dir]], ['root_files', task.root_files]];
  const leak = declared.find(([, paths]) => paths.some((x) => x.includes(canary)));
  if (leak) return refuse(leak[0], 'a declared path contains the canary');
  if (task.brief.includes(canary)) return refuse('brief', 'contains the canary');
  if (task.statements.some((s) => s.includes(canary))) return refuse('statements', 'a line contains the canary');
  if (task.turns.some((s) => s.includes(canary))) return refuse('turns', 'a line contains the canary');
  return null;
}

// One file under the task: where it may sit, that it still matches its hash, and that the canary is in every hidden file and in no
// file a candidate sees.
function fileProblem(l, p, fileHash, canary) {
  const top = p.split('/')[0];
  if (!p.includes('/') || !LAYOUT.includes(top)) return refuse('dir', `unexpected top-level entry at ${esc(p)}`);
  if (p.includes(canary)) return refuse(esc(p), 'the path contains the canary');
  const bytes = readSmall(l.f, `${l.root}/${p}`, MAX_FILE_BYTES);
  if (bytes === null || createHash('sha256').update(bytes).digest('hex') !== fileHash) return refuse(esc(p), 'unreadable, too large or changed since it was hashed');
  // A file a candidate sees must lack the canary and a hidden one must have it, so a file fails when the two agree.
  const visible = top === 'fixture';
  if (visible === bytes.includes(Buffer.from(canary))) return refuse(esc(p), visible ? 'candidate-visible file contains the canary' : 'missing the canary');
  return null;
}

export function canaryCheck(dir, opts) {
  try {
    const l = load(dir, opts);
    if (!l.ok) return l;
    const leak = declaredLeak(l.task, l.task.canary);
    if (leak) return leak;
    const found = new Set();
    for (const [p, fileHash] of l.m.files.filter(([name]) => name !== 'task.json')) {
      const problem = fileProblem(l, p, fileHash, l.task.canary);
      if (problem) return problem;
      found.add(p.split('/')[0]);
    }
    const none = HIDDEN_DIRS.find((d) => !found.has(d));
    return none === undefined ? { ok: true, hash: digest(l.m.files) } : refuse(`${none}/`, 'has no files (a check over nothing proves nothing)');
  } catch { return refuse('dir', 'unreadable'); }
}
