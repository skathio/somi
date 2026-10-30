// loop-review.mjs -- what /code-loop's reviewer must see (which lens, which scope), decided from recorded state
// rather than from the reviewer's reading of evidence. Shared by scripts/somi-loop.mjs; no output of its own.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readRecord } from './tier-record.mjs';
import { LoopExit, usageError } from './loop-exit.mjs';
import { CONTROL } from './loop-notes.mjs';

// The sizing record decides the review lens: a work item that may handle untrusted input or touch auth, crypto,
// secrets or PII (security_lens in scripts/somi-tier.mjs's record) is reviewed with the security lens on every
// pass. No record, or a record without the flag, asks for nothing beyond the loop's configured mode.
export function reviewMinFor(root, slug) {
  return readRecord(root, slug)?.security_lens === true ? 'security' : null;
}

const EXCLUDE = ':(exclude)';
const PATHSPEC = ['.', `${EXCLUDE}.somi`, `${EXCLUDE}.claude`];
const MAX_LISTING = 256 * 1024 * 1024; // bytes of git output read in one go; a bigger listing is refused, never truncated
export const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_BLOB = 1024 * 1024; // a blob over this is counted by size (50 bytes a line) instead of read
const cannot = (what) => Object.assign(usageError(`cannot measure the diff: ${what}; nothing was counted, so this refuses`), { what });
// Every git call here reads the repository whose top level is the first directory at or above `root` (resolved through
// symlinks) that has a .git entry (git's own discovery, which does not trust core.worktree), provided that entry is a
// git directory or a `gitdir: <path>` file pointing at one; anything else is refused, not skipped. The repository selectors in the caller's
// environment are dropped and the git directory and work tree are pinned (a core.worktree in the repository's own
// config would otherwise point every call at another directory), while `-C root` and the `.`-relative pathspecs keep
// the measurement to root's own subtree. core.ignoreCase is always false, so no config line can make git treat
// Foo.txt as the tracked foo.txt (on a case-insensitive filesystem a case-only rename then over-counts: the safe side).
// It never goes through a replace ref (which would hand the gate a substitute for the real blob), a core.fsmonitor
// program or a hook, none of which git should run for a measurement.
const SELECTORS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES', 'GIT_ICASE_PATHSPECS', 'GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS'];
const SAFE = ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${os.devNull}`, '-c', 'core.ignoreCase=false']; // shortcut: a null-device hooksPath is unverified on Windows, check it before supporting that
const bare = () => { const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' }; for (const k of SELECTORS) delete env[k]; return env; };
// A git directory, as far as one can tell without trusting it: a HEAD, and objects of its own or a commondir (a linked
// worktree's directory has no objects). Forged internals inside it are an accepted residual.
const isGitDir = (p) => present(path.join(p, 'HEAD')) && (present(path.join(p, 'objects')) || present(path.join(p, 'commondir')));
const validGit = (d) => {
  const g = path.join(d, '.git');
  try {
    const st = fs.statSync(g);
    if (st.isDirectory()) return isGitDir(g);
    if (!st.isFile() || st.size > 4096) return false;
    const fd = fs.openSync(g, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); // never follows a link to a pseudo-file, never blocks
    let text;
    try { const buf = Buffer.alloc(4097); const n = fs.readSync(fd, buf, 0, 4097, 0); if (n > 4096) return false; text = buf.toString('utf8', 0, n); } finally { fs.closeSync(fd); }
    const m = /^gitdir: ([^\r\n]+)[\r\n]*$/.exec(text); // one line, ending in CRLF or blank lines as git reads it; a relative path is relative to the gitfile's directory
    return m !== null && isGitDir(path.resolve(d, m[1]));
  } catch { return false; }
};
const topLevel = (root) => {
  for (let d = root; ; d = path.dirname(d)) {
    if (present(path.join(d, '.git'))) {
      if (!validGit(d)) throw cannot(`"${shownTail(path.join(d, '.git'))}" is neither a git directory nor a "gitdir: <path>" file that points at one`);
      return d;
    }
    if (path.dirname(d) === d) throw cannot('no git repository (.git) at or above the project directory');
  }
};
const run = (root, args, opts = {}) => {
  let real; // a project reached through a symlink is measured under its real path, the one git's own cwd reports
  try { real = fs.realpathSync(root); } catch { throw cannot('the project directory cannot be resolved'); }
  const top = topLevel(real);
  const pinned = { ...bare(), GIT_WORK_TREE: top };
  const GIT_DIR = execFileSync('git', ['-C', top, ...SAFE, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8', env: pinned }).trim();
  return execFileSync('git', ['-C', real, ...SAFE, ...args], { ...opts, env: { ...pinned, GIT_DIR, ...opts.env } });
};
const present = (p) => { try { fs.lstatSync(p); return true; } catch (e) { return e.code !== 'ENOENT'; } };
const shown = (v) => String(v).replace(CONTROL, '').slice(0, 80); // a path or a git message as text a person can read: no control characters, bounded
const shownTail = (v) => { const t = String(v).replace(CONTROL, ''); return t.length > 80 ? `…${t.slice(-79)}` : t; }; // the same, keeping the end (a path's last part names the problem)

// Refuses what would make the snapshot smaller than the tree or run code outside the hooks: an index flag that
// hides edits (assume-unchanged `h`; skip-worktree `S` on a file that is on disk, as a sparse checkout leaves the
// files it left out absent; the throwaway index inherits them), a git replace ref (it swaps a file's content), and a
// clean, smudge or process filter in this repository's own config, its worktree config or the command line (git add
// runs it). Filters in the user's or system config (git-lfs, say) are not checked: they are the user's own tools, a
// residual left open.
function refuseHidden(root) {
  let listing; let replaced; let filters = '';
  try {
    listing = run(root, ['ls-files', '-v', '-z'], { encoding: 'utf8', maxBuffer: MAX_LISTING }).split('\0');
    replaced = run(root, ['for-each-ref', '--count=1', 'refs/replace'], { encoding: 'utf8' }).trim();
    try {
      filters = run(root, ['config', '--show-scope', '--includes', '--get-regexp', '-z', '^filter\\.'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) { if (e.status !== 1) throw e; } // exit 1: no such key
  } catch (e) {
    if (e instanceof LoopExit) throw e;
    throw cannot('git could not read the index flags, the replace refs or the repository config');
  }
  if (replaced) throw cannot('the repository has git replace refs, which swap what a file contains (git replace -d removes them)');
  const hidden = listing.find((t) => /^[hs] /.test(t) || (t.startsWith('S ') && present(path.join(root, t.slice(2)))));
  if (hidden) throw cannot(`the index marks "${shown(hidden.slice(2))}" assume-unchanged or skip-worktree, which hides its edits (git update-index --no-assume-unchanged --no-skip-worktree)`);
  const toks = filters.split('\0'); // pairs of a scope and "key\nvalue"
  const filter = toks.filter((t, i) => i % 2).map((t, i) => [toks[2 * i], t.split('\n')[0]])
    .find(([scope, key]) => ['local', 'worktree', 'command'].includes(scope) && /^filter\..+\.(clean|smudge|process)$/i.test(key));
  if (filter) throw cannot(`the repository config defines ${shown(filter[1])}, and git add would run it`);
}

// The gate does not support submodules: their files are in no tree it builds (the superproject records a commit), and
// counting them would take a snapshot each. A repository with one is refused before anything is measured: a gitlink in
// the index, a gitlink in HEAD (what `git rm --cached` leaves), or a checked-out submodule, which git lists as an
// untracked directory with a trailing slash (a nested repository). .somi/ and .claude/ are outside the measurement.
const EXCLUDED = /^\.(somi|claude)(\/|$)/;
function refuseSubmodules(root) {
  const list = (args) => {
    try {
      return run(root, args, { encoding: 'utf8', maxBuffer: MAX_LISTING }).split('\0');
    } catch (e) {
      if (e instanceof LoopExit) throw e;
      throw cannot('git could not look for submodules');
    }
  };
  const gitlinks = (rows) => rows.filter((t) => t.startsWith('160000 ')).map((t) => t.slice(t.indexOf('\t') + 1));
  let unborn = false; // a repository with no commit has no gitlink in HEAD
  try { run(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { stdio: 'ignore' }); } catch (e) { if (e instanceof LoopExit) throw e; if (e.status !== 1) throw cannot('git could not read HEAD'); unborn = true; }
  const found = [...gitlinks(list(['ls-files', '-s', '-z'])), ...(unborn ? [] : gitlinks(list(['ls-tree', '-r', '-z', 'HEAD']))), ...list(['ls-files', '-o', '--exclude-standard', '-z']).filter((t) => t.endsWith('/'))]
    .find((p) => !EXCLUDED.test(p));
  if (found !== undefined) throw cannot(`the loop's diff gate does not support repositories with submodules (${shown(found)})`);
}

// The working tree as a git tree object: tracked and untracked files, .somi/ and .claude/ excluded, the same
// surface the diff cap measures. Built through a throwaway copy of the index so the caller's index is never
// touched (a copy rather than an empty index, so unchanged files are not re-hashed). Throws a refusal when git
// cannot index the whole tree (an unreadable file, a path it reserves): a partial tree is a smaller diff.
// Residual: the copied index is trusted, so a hand-edited `.git/index` (an entry's blob id swapped, its stat data
// kept) can make an edited file count as unchanged. The gate does not defend against forged git internals; the
// reviewer and the coder's sandbox do.
export function measuredTree(root) {
  refuseSubmodules(root);
  refuseHidden(root);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-tree-'));
  const index = path.join(dir, 'index');
  try {
    const real = run(root, ['rev-parse', '--path-format=absolute', '--git-path', 'index'], { encoding: 'utf8' }).trim();
    if (fs.existsSync(real)) { // the copy keeps the original's times: a newer index would make an edit made in the same second look clean
      fs.copyFileSync(real, index);
      const st = fs.statSync(real); fs.utimesSync(index, st.atime, st.mtime);
    }
    const env = { GIT_INDEX_FILE: index };
    // git add refuses an exclusion that names only ignored paths (a .gitignore with `.somi`) and would not add them anyway
    const ignored = (p) => { try { run(root, ['check-ignore', '-q', '--no-index', '--', p], { stdio: 'ignore' }); return true; } catch { return false; } };
    const spec = PATHSPEC.filter((p) => !p.startsWith(EXCLUDE) || !ignored(p.slice(EXCLUDE.length)));
    // Stat settings are pinned: a looser one would let a same-size edit with a put-back mtime read as clean.
    // --sparse: an untracked file outside a sparse checkout's cone is still part of the tree.
    const pinned = ['-c', 'core.trustctime=true', '-c', 'core.checkStat=default'];
    run(root, [...pinned, 'add', '-A', '--sparse', '--', ...spec], { env, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
    return run(root, ['write-tree'], { env, encoding: 'utf8' }).trim();
  } catch (e) {
    if (e instanceof LoopExit) throw e;
    const text = String(e.stderr ?? '');
    const invalid = /^error: invalid path '(.*)'$/m.exec(text)?.[1]; // git reserves some names (a case variant of .git, say) and will not add them
    if (invalid !== undefined) throw cannot(`git refuses the path "${shown(invalid)}" as invalid, so the tree cannot be built: rename or remove it`);
    const why = shown(text.split('\n').find((l) => l.trim()) ?? '');
    throw cannot(`git could not index the working tree${why ? ` (${why})` : ''}; an unreadable file cannot be counted: remove it or add it to .gitignore`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// HEAD of the repository under `root`, read the way the measurement reads: through the pinned git. A refusal (exit 64)
// when it cannot be read; the loop's baseline is this commit.
export function headCommit(root) {
  let id;
  try {
    id = run(root, ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    throw usageError(`cannot resolve HEAD: ${e instanceof LoopExit ? e.what : 'the repository has no commit yet, or HEAD is unreadable (commit once, then init)'}`);
  }
  if (!OBJECT_ID.test(id)) throw usageError('cannot resolve HEAD: git printed something that is not an object id');
  return id;
}

// -> tree id, or null when the tree cannot be built (callers that only narrow a review treat null as "no snapshot").
export function snapshotTree(root) {
  try { return measuredTree(root); } catch { return null; }
}

// Lines in each blob: newlines, plus one for an unterminated last line, but at least one per 50 bytes. A blob over
// MAX_BLOB is counted by size alone rather than read. -> Map of blob id to lines.
function blobLines(root, ids) {
  const lines = new Map();
  const want = [...new Set(ids)].filter((id) => /^0+$/.test(id) ? !lines.set(id, 0) : true);
  if (!want.length) return lines;
  const cat = (mode, ids2) => {
    try {
      return run(root, ['cat-file', mode], { input: ids2.join('\n') + '\n', maxBuffer: MAX_LISTING, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (e) {
      throw cannot(e.code === 'ENOBUFS' ? 'the changed files hidden from diff are too large to read' : 'git could not read a changed file');
    }
  };
  const sizes = cat('--batch-check', want).toString('latin1').split('\n').slice(0, want.length).map((l) => /^[0-9a-f]+ blob (\d+)$/.exec(l)?.[1]);
  if (sizes.some((z) => z === undefined)) throw cannot('git printed a blob size this cannot read');
  const small = [];
  want.forEach((id, i) => { if (Number(sizes[i]) > MAX_BLOB) lines.set(id, Math.ceil(Number(sizes[i]) / 50)); else small.push(id); });
  if (!small.length) return lines;
  const buf = cat('--batch', small);
  let pos = 0;
  for (const id of small) {
    const nl = buf.indexOf(10, pos);
    const size = Number(/^[0-9a-f]+ blob (\d+)$/.exec(buf.toString('latin1', pos, nl))?.[1]);
    if (nl < 0 || !Number.isInteger(size)) throw cannot('git printed a blob this cannot read');
    const body = buf.subarray(nl + 1, nl + 1 + size);
    let n = 0;
    for (let at = body.indexOf(10); at >= 0; at = body.indexOf(10, at + 1)) n++;
    lines.set(id, Math.max(n + (size > 0 && body[size - 1] !== 10 ? 1 : 0), Math.ceil(size / 50))); // never fewer than 50 bytes a line: a binary with no newline is not one line
    pos = nl + 1 + size + 1;
  }
  return lines;
}

// The files that differ between two trees (or a commit and a tree) as [{added, deleted, file}].
// NUL-separated, so a name with a tab, a quote or non-ASCII bytes is exact; renames off, so a rename into another
// path is the whole file added there and removed here. Both ids must be hex object ids, and follow --end-of-options.
// A file git prints as binary
// (a real binary, a NUL byte, or text a .gitattributes `-diff` or `binary` line hides) is counted from the object
// store: the lines of its old blob as deleted and of its new blob as added. Exact for hidden text, an upper bound for
// a real binary (a floor of one line per 50 bytes, so binaries count toward the cap), and not dodgeable by an attribute
// the coder adds.
export function treeNumstat(root, from, to) {
  if (![from, to].every((id) => typeof id === 'string' && OBJECT_ID.test(id))) throw cannot('a recorded revision is not an object id');
  const list = (...format) => {
    try {
      return run(root, ['diff', ...format, '-z', '--no-renames', '--relative', '--ignore-submodules=none', '--end-of-options', from, to, '--', ...PATHSPEC], { encoding: 'utf8', maxBuffer: MAX_LISTING, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0');
    } catch (e) {
      throw cannot(e.code === 'ENOBUFS' ? 'the changed-file listing is too large' : 'git diff failed');
    }
  };
  const raw = list('--raw', '--no-abbrev');
  const blobs = new Map(); // path -> [old blob id, new blob id]
  for (let i = 0; i + 1 < raw.length; i += 2) { // pairs of "<modes, ids, status>" and path: a name that starts with ':' is not mistaken for a record
    const [, , oldId, newId] = raw[i].split(' ');
    blobs.set(raw[i + 1], [oldId, newId]);
  }
  const rows = list('--numstat').filter((t) => t !== '').map((t) => {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(t);
    if (!m) throw cannot('git printed a line this cannot read');
    return { added: m[1] === '-' ? null : Number(m[1]), deleted: m[2] === '-' ? null : Number(m[2]), file: m[3] };
  });
  const ids = rows.filter((r) => r.added === null).flatMap((r) => blobs.get(r.file) ?? []);
  const lines = blobLines(root, ids);
  return rows.map(({ added, deleted, file }) => {
    if (added !== null) return { added, deleted, file };
    const [o, n] = blobs.get(file) ?? [];
    return o === undefined || o === n ? { added: 0, deleted: 0, file } : { added: lines.get(n), deleted: lines.get(o), file };
  });
}

export const REVIEW_SCOPES = Object.freeze(['delta', 'full']);

// What the generalist reviewer reads on this pass. Pass 1, the last allowed pass, a `full` setting, or a missing
// snapshot of the previous review all mean the whole iteration; otherwise only what changed since the last
// reviewed tree, plus the open findings it must re-check. The security lens is not narrowed by this.
export function reviewScope(root, state, setting) {
  const full = (why) => ({ scope: 'full', why });
  if (setting === 'full') return full('setting');
  if (state.pass <= 1) return full('first-pass');
  if (state.pass >= state.caps.max_passes) return full('last-pass');
  const prev = state.history.at(-1);
  if (!prev?.tree) return full('no-snapshot');
  const to = snapshotTree(root);
  if (!to) return full('no-snapshot');
  return { scope: 'delta', since_pass: prev.pass, from: prev.tree, to, files: treeNumstat(root, prev.tree, to).map((r) => r.file) };
}
