// Definition-set digest (FR-16): a content digest of the COMMITTED tree of the definition set (the six
// directories plus the root .gitattributes, which changes the bytes a draw installs), and a refusal
// when the working tree under it is not clean. Each function returns `null` for a malformed input and
// never throws; a git failure is a refusal, never read as "empty" or "clean".
//
// Callers digest HEAD: assertCleanTree proves the working tree equals HEAD, so another ref would bind a
// verdict to bytes that were never installed. `ls-tree` lists blob SHAs and never reads the working
// tree, so a CRLF checkout (core.autocrlf) digests like an LF one; the working tree is only asked "is
// it clean?", because a draw installs working-tree files.
//
// What is hashed. Entries {mode, type, sha, path} sorted by the UTF-8 bytes of `path`. The input to
// sha256 is the tag `somi-definition-set-v1` + NUL, then for each entry `<mode> <type> <sha>` + TAB +
// `<path>` + NUL. Closed grammar: mode 100644 100755 or 160000 (a symlink, 120000, is refused: it is
// hashed by its target path, not by what it points to), type blob|commit tied to the mode, sha 40 or 64
// lowercase hex, a path with no NUL, well-formed UTF-8, equal to `.gitattributes` or inside one of the
// six directories. NUL ends a record, so no file name (newline, quote, tab) makes two entry sets share
// bytes. A duplicate path, an empty set or a `.`, `..` or empty segment makes the input `null`. Output: 64 hex.
//
// Git runs with an argv array (no shell) and an environment built from an allowlist, so the caller's
// GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_CONFIG*, GIT_EXEC_PATH, LD_PRELOAD never reach it. HOME and
// XDG_CONFIG_HOME are kept: the user's global config (core.autocrlf) decides what "clean" means for their
// checkout. The repository's own config is the untrusted part: keys that execute or hide something are
// pinned by -c, replace-objects are off, and the repo must be the top level of its working tree. No
// function here takes a draw workspace: it is never hashed or inspected. Residuals: clean-filter drivers
// named by the repository's .gitattributes and config, a populated submodule's config, or a global or
// system config run as written during `status`; .git/info/attributes and core.attributesFile are
// maintainer-local; edits made after the check are not caught unless the check and digest are repeated
// after the arm finishes; on a SHA-1 repository the digest is as strong as SHA-1 with git's collision
// detection; PATH is the caller's; a user relying on GIT_CONFIG_GLOBAL gets a fail-closed "dirty".

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DEFINITION_SET_DIRS = Object.freeze(['commands', 'agents', 'skills', 'rules', 'scripts', 'hooks']);

const TAG = 'somi-definition-set-v1';
const REF = /^[A-Za-z0-9][A-Za-z0-9._/@^~+-]{0,199}$/;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MODE_TYPE = Object.freeze({ 100644: 'blob', 100755: 'blob', 160000: 'commit' });
const MAX_OUT = 16 * 1024 * 1024; // the output-cap test exercises the same error branch as the timeout
const TIMEOUT_MS = 30_000;
const KEPT_ENV = ['PATH', 'HOME', 'XDG_CONFIG_HOME', 'USERPROFILE', 'SystemRoot'];
const GIT_ARGS = ['--no-optional-locks', '--no-replace-objects', '--literal-pathspecs',
  '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fileMode=true', '-c', 'core.checkStat=default', '-c', 'core.trustctime=true'];
const SCOPE = Object.freeze(['.gitattributes', ...DEFINITION_SET_DIRS]); // the pathspec of every listing
const decoder = new TextDecoder('utf-8', { fatal: true });

// stdout of a hardened git call, or null on any failure (spawn error, signal, timeout, output cap, exit != 0).
function git(cwd, args) {
  try {
    const env = { LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_ATTR_NOSYSTEM: '1' };
    for (const k of KEPT_ENV) if (typeof process.env[k] === 'string') env[k] = process.env[k];
    const r = spawnSync('git', [...GIT_ARGS, ...args], { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: MAX_OUT, timeout: TIMEOUT_MS, killSignal: 'SIGKILL', windowsHide: true });
    return r.error || r.signal || r.status !== 0 ? null : r.stdout;
  } catch {
    return null;
  }
}

const isRepoArg = (repo) => typeof repo === 'string' && repo !== '' && !repo.includes('\0');

// Real path of `repo` when it is a directory that is the top level of a git working tree, else null.
function topLevel(repo) {
  try {
    const dir = fs.realpathSync(path.resolve(repo));
    if (!fs.statSync(dir).isDirectory()) return null;
    const out = git(dir, ['rev-parse', '--show-toplevel']);
    return out && fs.realpathSync(out.toString('utf8').replace(/\n$/, '')) === dir ? dir : null;
  } catch {
    return null;
  }
}

const inDefinitionSet = (p) => p === '.gitattributes' || DEFINITION_SET_DIRS.some((d) => p === d || p.startsWith(`${d}/`));

// Sorted plain copies of the entries (the array, every slot and every field read once), or null.
function copyEntries(entries) {
  if (!Array.isArray(entries)) return null;
  const n = entries.length;
  const out = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    if (!Object.hasOwn(entries, i)) return null;
    const e = entries[i];
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return null;
    const keys = Reflect.ownKeys(e);
    if (keys.length !== 4 || !['mode', 'type', 'sha', 'path'].every((k) => keys.includes(k))) return null;
    const { mode, type, sha, path: p } = e;
    if (typeof mode !== 'string' || !Object.hasOwn(MODE_TYPE, mode) || MODE_TYPE[mode] !== type) return null;
    if (typeof sha !== 'string' || !OID.test(sha) || typeof p !== 'string' || p.includes('\0') || !inDefinitionSet(p)) return null;
    const bytes = Buffer.from(p, 'utf8');
    if (bytes.toString('utf8') !== p || p.split('/').some((s) => s === '' || s === '.' || s === '..') || seen.has(p)) return null;
    seen.add(p);
    out.push({ mode, type, sha, path: p, bytes });
  }
  return out.length === 0 ? null : out.sort((a, b) => Buffer.compare(a.bytes, b.bytes));
}

/** sha256 hex of the canonical encoding of `entries` (see the header), or `null` for a malformed or empty set. */
export function digestEntries(entries) {
  try {
    const list = copyEntries(entries);
    if (!list) return null;
    const h = createHash('sha256').update(`${TAG}\0`);
    for (const e of list) h.update(`${e.mode} ${e.type} ${e.sha}\t`).update(e.bytes).update('\0');
    return h.digest('hex');
  } catch {
    return null;
  }
}

/**
 * The blob / submodule entries `{mode, type, sha, path}` of the definition set at commit `ref`
 * (a conservative ref name, resolved to a commit id first), or `null`: a ref that fails the pattern or
 * does not name a commit, a `repo` that is not the top level of a git working tree, or any git failure.
 */
export function committedEntries(repo, ref) {
  try {
    if (!isRepoArg(repo) || typeof ref !== 'string' || !REF.test(ref) || ref.includes('..')) return null;
    const top = topLevel(repo);
    const oid = top && git(top, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`])?.toString('latin1').trim();
    const out = oid && OID.test(oid) ? git(top, ['ls-tree', '-r', '-z', '--full-tree', oid, '--', ...SCOPE]) : null;
    if (!out) return null;
    const records = decoder.decode(out).split('\0');
    if (records.pop() !== '') return null;
    const entries = [];
    for (const rec of records) {
      const m = /^(\d{6}) (blob|commit) ([0-9a-f]+)\t([^]+)$/.exec(rec);
      if (!m) return null;
      entries.push({ mode: m[1], type: m[2], sha: m[3], path: m[4] });
    }
    return entries.length === 0 || copyEntries(entries) ? entries : null;
  } catch {
    return null;
  }
}

/** Definition-set digest of the committed tree at `ref`, or `null` (missing ref, git failure, no entries). */
export function definitionSetDigest(repo, ref) {
  const entries = committedEntries(repo, ref);
  return entries ? digestEntries(entries) : null;
}

// The first path of a NUL-separated list of `<2-char status> <path>` records, '' when none, null if malformed.
function firstPath(out, skip) {
  const records = out.toString('utf8').split('\0');
  if (records.pop() !== '') return null;
  return records.length === 0 ? '' : records[0].length > skip ? records[0].slice(skip) : null;
}

/**
 * Refuse unless the working tree of the definition set matches the index and HEAD. `{ok:true}`, or
 * `{ok:false, reason}` naming the first offending path (JSON-quoted, so a control character in a file
 * name cannot reach a terminal) or the git failure. Modified, staged, untracked and ignored files all
 * count (a draw would install them), and so does an index entry hidden by assume-unchanged or
 * skip-worktree. `null` for a `repo` that is not a non-empty string.
 */
export function assertCleanTree(repo) {
  try {
    if (!isRepoArg(repo)) return null;
    const top = topLevel(repo);
    if (!top) return { ok: false, reason: 'not the top level of a git working tree' };
    const status = git(top, ['status', '--porcelain', '-z', '--no-renames', '--untracked-files=all', '--ignored=traditional', '--ignore-submodules=none', '--', ...SCOPE]);
    const hidden = git(top, ['ls-files', '-v', '-z', '--', ...SCOPE]);
    const dirty = status && firstPath(status, 3);
    if (dirty === null || dirty === undefined || !hidden) return { ok: false, reason: 'git could not report the tree state' };
    if (dirty !== '') return { ok: false, reason: `dirty definition-set path ${JSON.stringify(dirty).slice(0, 200)}` };
    const odd = hidden.toString('utf8').split('\0').find((r) => r !== '' && !r.startsWith('H '));
    return odd === undefined ? { ok: true } : { ok: false, reason: `index entry hidden from status ${JSON.stringify(odd.slice(2)).slice(0, 200)}` };
  } catch {
    return { ok: false, reason: 'git could not report the tree state' };
  }
}
