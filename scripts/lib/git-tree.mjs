// git-tree.mjs: the working tree as git objects. Tracked, staged and untracked files go into a throwaway index and become a tree
// id, so "what changed" is a content hash, a re-run on an unchanged tree is recognisable, and a reviewer can read an exact diff.
// Nothing here touches the real index. SoMi's own state is left out so writing a record never changes the tree.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.trustctime=true', '-c', 'core.checkStat=default', '-c', 'core.quotePath=false'];
const DIFF = ['--no-ext-diff', '--no-textconv', '--no-renames', '--no-color'];
const MAX_OUTPUT = 32 * 1024 * 1024;

const git = (root, args, opts = {}) => execFileSync('git', [...SAFE, ...args], { cwd: root, encoding: 'utf8', maxBuffer: MAX_OUTPUT, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

// A repository's config can name programs git runs while reading files, and the MCP server runs outside the sandbox, so reading the tree
// must never start one. Files already in the index keep their cached stat, so switching filters off does not make them look changed.
function noFilters(root) {
  let names = [];
  try { names = git(root, ['config', '--name-only', '--get-regexp', '^filter\\.']).split('\n'); } catch { /* git exits 1 when there are none */ }
  const drivers = new Set(names.map((n) => /^filter\.(.+)\.[^.]+$/.exec(n)?.[1]).filter(Boolean));
  return [...drivers].flatMap((d) => ['-c', `filter.${d}.clean=`, '-c', `filter.${d}.smudge=`, '-c', `filter.${d}.process=`, '-c', `filter.${d}.required=false`]);
}

export function isClean(root) {
  return git(root, [...noFilters(root), 'status', '--porcelain', '--', '.', ':(glob,exclude)**/.somi/**']).trim() === '';
}

export const stateIsTracked = (root) => git(root, ['ls-files', '--cached', '--', ':(glob)**/.somi/state/**']).trim() !== '';

// The tree of a commit or tree id, for telling "nothing changed" apart from "changed and already committed".
export const treeOf = (root, ref) => git(root, ['rev-parse', '--verify', `${ref}^{tree}`]).trim();

// Everything except SoMi's own folder, in one commit, with a message that never passes through a shell.
export function commitAll(root, message) {
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['reset', '-q', '--', ':(glob)**/.somi/**'], { cwd: root, stdio: 'ignore' });
  if (execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' }).trim() === '') return false;
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: root, stdio: 'ignore' });
  return true;
}

export function repoRoot(cwd) {
  return git(cwd, ['rev-parse', '--show-toplevel']).trim();
}

// What a commit adds to: the last commit when there is work not yet committed, as before a commit, or else the last commit's parent, so
// the last commit itself is scored. With no parent it is the empty tree.
export function commitBase(root) {
  const head = headSha(root);
  if (head === null) return baseRef(root);
  if (!isClean(root)) return head;
  try { return git(root, ['rev-parse', '--verify', '--quiet', 'HEAD^']).trim(); } catch { return git(root, ['hash-object', '-t', 'tree', '--stdin'], { stdio: ['pipe', 'pipe', 'pipe'], input: '' }).trim(); }
}

export function headSha(root) {
  try { return git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).trim(); } catch { return null; }
}

export function baseRef(root) {
  return headSha(root) ?? git(root, ['hash-object', '-t', 'tree', '--stdin'], { stdio: ['pipe', 'pipe', 'pipe'], input: '' }).trim();
}

// Where this line of work left the shared history. A branch compares against the default branch. On the default branch itself it
// compares against its upstream. With neither, only what is not committed yet counts.
export function workBase(root) {
  const quiet = (args) => { try { return git(root, args, { stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  const head = headSha(root);
  if (head === null) return baseRef(root);
  for (const ref of ['origin/HEAD', 'origin/main', 'main', 'origin/master', 'master']) {
    const shared = quiet(['merge-base', head, ref]);
    if (shared && shared !== head) return shared;
    if (shared) break;
  }
  const upstream = quiet(['merge-base', head, '@{upstream}']);
  return upstream ?? head;
}

// Subjects of the commits since a base, oldest first, with hostile control characters left for the renderer to strip.
export function commitSubjects(root, from) {
  if (!OBJECT_ID.test(String(from))) throw new Error('a recorded revision is not an object id');
  try { return git(root, ['log', '--reverse', '--format=%s', `${from}..HEAD`]).split('\n').filter(Boolean); } catch { return []; }
}

export function resolveRef(root, ref) {
  return git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
}

export function snapshotTree(root) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-tree-'));
  const index = path.join(dir, 'index');
  const env = { ...process.env, GIT_INDEX_FILE: index, GIT_OPTIONAL_LOCKS: '0' };
  try {
    const real = git(root, ['rev-parse', '--path-format=absolute', '--git-path', 'index']).trim();
    // The copy keeps the original's times. A newer index would make a same-size edit made in the same second look clean.
    if (fs.existsSync(real)) {
      fs.copyFileSync(real, index);
      const st = fs.statSync(real);
      fs.utimesSync(index, st.atime, st.mtime);
    }
    const off = noFilters(root);
    git(root, [...off, 'add', '-A', '--', '.'], { env });
    // The audit log grows on every tool call, so in a repository that does not ignore it, keeping it would make every tree new.
    git(root, [...off, 'rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', ':(glob)**/.somi/state/**', ':(glob)**/.somi/audit.log'], { env });
    return git(root, [...off, 'write-tree'], { env }).trim();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const OBJECT_ID = /^[0-9a-f]{40,64}$/;

const stripPrefix = (name, prefix) => name.replace(new RegExp(`^"?${prefix}/`), '').replace(/"$/, '');

// A file header names the file, from its old side and then its new one. /dev/null on either side leaves the name the other gave.
function headerLine(state, line) {
  for (const [marker, prefix] of [['--- ', 'a'], ['+++ ', 'b']]) {
    if (line.startsWith(marker) && line !== `${marker}/dev/null`) state.file = stripPrefix(line.slice(4), prefix);
  }
}

// [{ file, sign: '+'|'-', text }]. Only the file header needs care: a removed line starting `-- ` must not read as one, so headers
// are read only before a file's first hunk.
export function parsePatch(patch) {
  const out = [];
  const state = { file: null, inHunk: false };
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) Object.assign(state, { file: null, inHunk: false });
    else if (line.startsWith('@@')) state.inHunk = true;
    else if (!state.inHunk) headerLine(state, line);
    else if (state.file !== null && (line[0] === '+' || line[0] === '-')) out.push({ file: state.file, sign: line[0], text: line.slice(1) });
  }
  return out;
}

// Per-file rows plus the patch's added and removed lines. A diff too large to read returns `unreadable`, which signals reads as
// "everything fired": a change that cannot be measured must not look small.
export function readDiff(root, from, to) {
  if (!OBJECT_ID.test(from) || !OBJECT_ID.test(to)) throw new Error('a recorded revision is not an object id');
  try {
    const status = git(root, ['diff', ...DIFF, '--name-status', '-z', from, to]).split('\0').filter(Boolean);
    const letters = new Map();
    for (let i = 0; i + 1 < status.length; i += 2) letters.set(status[i + 1], status[i]);
    const rows = git(root, ['diff', ...DIFF, '--numstat', '-z', from, to]).split('\0').filter(Boolean).map((t) => {
      const [added, deleted, ...name] = t.split('\t');
      const file = name.join('\t');
      return { file, added: added === '-' ? 0 : Number(added), deleted: deleted === '-' ? 0 : Number(deleted), status: letters.get(file) ?? 'M' };
    });
    return { rows, lines: parsePatch(git(root, ['diff', ...DIFF, '-U0', from, to])), unreadable: false };
  } catch (e) {
    if (e.code === 'ENOBUFS') return { rows: [], lines: [], unreadable: true };
    throw e;
  }
}

// What a diff added, per file: { file → { status, added: [[first, last], ...] } }, with line numbers in the new version. The quality
// gate scores only the functions these lines touch.
function changedFiles(root, from, to) {
  const out = new Map();
  const status = git(root, ['diff', ...DIFF, '--name-status', '-z', from, to]).split('\0').filter(Boolean);
  for (let i = 0; i + 1 < status.length; i += 2) out.set(status[i + 1], { status: status[i], added: [], hunks: [] });
  return out;
}

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

// A hunk header's new side: its first line and how many lines it holds there. A hunk that only removes holds none. How many lines it
// held on the old side is kept too, so a line the change did not touch can be traced back to where it was.
function addHunk(entry, line) {
  const hunk = HUNK.exec(line);
  if (!hunk || !entry) return;
  const first = Number(hunk[2]);
  const count = hunk[3] === undefined ? 1 : Number(hunk[3]);
  if (count > 0) entry.added.push([first, first + count - 1]);
  entry.hunks.push({ first, count, removed: hunk[1] === undefined ? 1 : Number(hunk[1]) });
}

/** Where a line of the new version was in the old one, from addedRanges' hunks, or null when the change added it. */
export function oldLine(hunks, line) {
  let shift = 0;
  for (const h of hunks) {
    if (h.count > 0 && line >= h.first && line < h.first + h.count) return null;
    const before = h.count > 0 ? h.first + h.count - 1 < line : h.first < line;
    if (before) shift += h.count - h.removed;
  }
  return line - shift;
}

export function addedRanges(root, from, to) {
  if (!OBJECT_ID.test(from) || !OBJECT_ID.test(to)) throw new Error('a recorded revision is not an object id');
  const out = changedFiles(root, from, to);
  let file = null;
  for (const line of git(root, ['diff', ...DIFF, '-U0', from, to]).split('\n')) {
    if (line.startsWith('+++ ')) file = line === '+++ /dev/null' ? null : stripPrefix(line.slice(4), 'b');
    else addHunk(file === null ? null : out.get(file), line);
  }
  return out;
}

/** Every file path in a commit or tree. */
export function listFiles(root, rev) {
  if (!OBJECT_ID.test(rev)) throw new Error('a recorded revision is not an object id');
  return git(root, ['ls-tree', '-r', '--name-only', '-z', rev]).split('\0').filter(Boolean);
}

/** A file's text at a commit or tree, or null when it is not there. */
export function fileAt(root, rev, file) {
  if (!OBJECT_ID.test(rev)) throw new Error('a recorded revision is not an object id');
  try { return git(root, ['cat-file', '-p', `${rev}:${file}`]); } catch { return null; }
}

const BATCH = 200;

/** Many files' text at a commit or tree, read by one git process per batch: a Map from file to text, without the files not there. */
export function filesAt(root, rev, files) {
  if (!OBJECT_ID.test(rev)) throw new Error('a recorded revision is not an object id');
  const texts = new Map();
  for (let i = 0; i < files.length; i += BATCH) {
    for (const [file, text] of readBatch(root, rev, files.slice(i, i + BATCH))) if (text !== null) texts.set(file, text);
  }
  return texts;
}

// [file, text or null] for each file, in order. The batch protocol is one name per line, so a name with a newline in it is read on its
// own, and so is every file of a batch too large to buffer.
function readBatch(root, rev, files) {
  const named = files.filter((f) => !f.includes('\n'));
  let out = null;
  try { out = git(root, ['cat-file', '--batch'], { encoding: null, stdio: ['pipe', 'pipe', 'pipe'], input: named.map((f) => `${rev}:${f}\n`).join('') }); } catch { /* read one by one */ }
  const read = out ? parseBatch(out, named) : new Map();
  return files.map((f) => [f, out && !f.includes('\n') ? read.get(f) ?? null : fileAt(root, rev, f)]);
}

// Each answer is "<id> <type> <size>" and the content, or one line saying the name is missing.
function parseBatch(out, names) {
  const read = new Map();
  let at = 0;
  for (const name of names) {
    const end = out.indexOf(10, at);
    if (end < 0) break;
    const header = /^[0-9a-f]+ (\w+) (\d+)$/.exec(out.toString('utf8', at, end));
    at = end + 1;
    if (!header) continue;
    const size = Number(header[2]);
    if (header[1] === 'blob') read.set(name, out.toString('utf8', at, at + size));
    at += size + 1;
  }
  return read;
}

// This string reaches an agent as a command, and its ids come from a state file, so anything but an object id is refused.
export function reviewDiffCommand(from, to) {
  if (!OBJECT_ID.test(String(from)) || !OBJECT_ID.test(String(to))) throw new Error('a recorded revision is not an object id');
  return `git diff --no-ext-diff --no-textconv ${from} ${to}`;
}
