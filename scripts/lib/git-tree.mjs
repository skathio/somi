// git-tree.mjs: the working tree as git objects. Tracked, staged and untracked files go into a throwaway index and become a tree
// id, so "what changed" is a content hash, a re-run on an unchanged tree is recognisable, and a reviewer can read an exact diff.
// Nothing here touches the real index. SoMi's own state is left out so writing the journal never changes the tree.

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

export function headSha(root) {
  try { return git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).trim(); } catch { return null; }
}

export function baseRef(root) {
  return headSha(root) ?? git(root, ['hash-object', '-t', 'tree', '--stdin'], { stdio: ['pipe', 'pipe', 'pipe'], input: '' }).trim();
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

// [{ file, sign: '+'|'-', text }]. Only the file header needs care: a removed line starting `-- ` must not read as one.
export function parsePatch(patch) {
  const out = [];
  let file = null;
  let inHunk = false;
  const strip = (name, prefix) => name.replace(new RegExp(`^"?${prefix}/`), '').replace(/"$/, '');
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) { inHunk = false; file = null; continue; }
    if (line.startsWith('@@')) { inHunk = true; continue; }
    if (!inHunk && line.startsWith('--- ')) { if (line !== '--- /dev/null') file = strip(line.slice(4), 'a'); continue; }
    if (!inHunk && line.startsWith('+++ ')) { if (line !== '+++ /dev/null') file = strip(line.slice(4), 'b'); continue; }
    if (inHunk && file !== null && (line[0] === '+' || line[0] === '-')) out.push({ file, sign: line[0], text: line.slice(1) });
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

// This string reaches an agent as a command, and its ids come from a state file, so anything but an object id is refused.
export function reviewDiffCommand(from, to) {
  if (!OBJECT_ID.test(String(from)) || !OBJECT_ID.test(String(to))) throw new Error('the journal holds something that is not an object id');
  return `git diff --no-ext-diff --no-textconv ${from} ${to}`;
}
