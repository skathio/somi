// loop-review.mjs -- what /code-loop's reviewer must see (which lens, which scope), decided from recorded state
// rather than from the reviewer's reading of evidence. Shared by scripts/somi-loop.mjs; no output of its own.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
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
// The time one git call may take. A call that exceeds it is a refusal (exit 64, "git did not answer") from every caller: the CLI prints
// the message and exits 64, a step answers exit 64, and no gate passes on a measurement that was not made. Mutable for the tests only.
// shortcut: one limit for all calls, so a repository too large for 60 s is refused; raise it when one is reported.
export const LIMITS = { gitTimeoutMs: 60000, snapshotBytes: 256 * 1024 * 1024 }; // snapshotBytes: file content one ignored-file snapshot reads, past which a file is stood for by its size and change time
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
// The directories git says it could not open, as { dir, why }: only git's own warning line (LC_ALL=C pins its text), so a file name inside another
// warning, which never starts a line with this text, is not one. A directory that vanished while git walked (ENOENT) hides nothing and is skipped.
const NOT_OPENED = /^warning: could not open directory '(.*)': (.*)$/gm;
export const unopened = (stderr) => [...String(stderr).matchAll(NOT_OPENED)].filter((m) => m[2] !== 'No such file or directory').map((m) => ({ dir: m[1], why: m[2] }));
const run = (root, args, opts = {}) => {
  let real; // a project reached through a symlink is measured under its real path, the one git's own cwd reports
  try { real = fs.realpathSync(root); } catch { throw cannot('the project directory cannot be resolved'); }
  const top = topLevel(real);
  const pinned = { ...bare(), GIT_WORK_TREE: top };
  const limit = { timeout: LIMITS.gitTimeoutMs, killSignal: 'SIGKILL' };
  try {
    const GIT_DIR = execFileSync('git', ['-C', top, ...SAFE, 'rev-parse', '--absolute-git-dir'], { ...limit, encoding: 'utf8', env: pinned }).trim();
    const { unlistable, ...rest } = opts;
    if (!unlistable) return execFileSync('git', ['-C', real, ...SAFE, ...args], { ...limit, ...rest, env: { ...pinned, GIT_DIR, ...rest.env } });
    // unlistable: git lists the tree, and a directory it cannot open is a warning on stderr with exit 0, so the listing is shorter than the tree (a
    // policy folder made enterable but not listable hides a new file from it). The caller pipes stderr; that warning is a refusal, with no path in it.
    const r = spawnSync('git', ['-C', real, ...SAFE, ...args], { ...limit, ...rest, env: { ...pinned, GIT_DIR, LC_ALL: 'C', ...rest.env } });
    if (r.error) throw r.error;
    if (r.status !== 0) throw Object.assign(new Error(`git exited ${r.status}`), { status: r.status, stderr: r.stderr });
    const own = path.relative(top, real).split(path.sep).join('/'); // git names the directory from the repository top, the callers from the project root
    const dirs = unopened(r.stderr).map(({ dir, why }) => ({ dir: (own !== '' && dir.startsWith(`${own}/`) ? dir.slice(own.length + 1) : dir).replace(/\/$/, ''), why }));
    if (dirs.length) throw Object.assign(cannot('git could not open a directory, so its listing is shorter than the tree (make the directory listable, remove it, or add it to .gitignore)'), { unlistable: true, dirs, stdout: r.stdout });
    return r.stdout;
  } catch (e) { // fails closed: a git that does not answer is a refusal, so the loop counts nothing, never a smaller diff
    if (e.code === 'ETIMEDOUT') throw cannot(`git did not answer within ${LIMITS.gitTimeoutMs / 1000} seconds (retry once it responds)`);
    throw e;
  }
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
export function refuseSubmodules(root) {
  const list = (args) => {
    try {
      return run(root, args, { encoding: 'utf8', maxBuffer: MAX_LISTING, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0');
    } catch (e) {
      if (e instanceof LoopExit) throw e;
      throw cannot('git could not look for submodules');
    }
  };
  const gitlinks = (rows) => rows.filter((t) => t.startsWith('160000 ')).map((t) => t.slice(t.indexOf('\t') + 1));
  let unborn = false; // a repository with no commit has no gitlink in HEAD
  try { run(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { stdio: 'ignore' }); } catch (e) { if (e instanceof LoopExit) throw e; if (e.status !== 1) throw cannot('git could not read HEAD'); unborn = true; }
  const nested = list(['ls-files', '-o', '--exclude-standard', '-z']).filter((t) => t.endsWith('/'));
  const found = [...gitlinks(list(['ls-files', '-s', '-z'])), ...(unborn ? [] : gitlinks(list(['ls-tree', '-r', '-z', 'HEAD'])))].find((p) => !EXCLUDED.test(p));
  const untracked = found === undefined ? nested.find((p) => !EXCLUDED.test(p)) : undefined;
  const hint = untracked === undefined ? '' : '; if it is not a submodule, add it to .gitignore';
  if (found !== undefined || untracked !== undefined) throw cannot(`the loop's diff gate does not support repositories with submodules (${shown(found ?? untracked)})${hint}`);
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
    const ignored = (p) => { try { run(root, ['check-ignore', '-q', '--no-index', '--', p], { stdio: 'ignore' }); return true; } catch (e) { if (e instanceof LoopExit) throw e; return false; } };
    const spec = PATHSPEC.filter((p) => !p.startsWith(EXCLUDE) || !ignored(p.slice(EXCLUDE.length)));
    // Stat settings are pinned: a looser one would let a same-size edit with a put-back mtime read as clean.
    // --sparse: an untracked file outside a sparse checkout's cone is still part of the tree.
    const pinned = ['-c', 'core.trustctime=true', '-c', 'core.checkStat=default'];
    run(root, [...pinned, 'add', '-A', '--sparse', '--', ...spec], { env, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], unlistable: true });
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
      if (e instanceof LoopExit) throw e;
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

// The files that differ between two trees (or a commit and a tree) as [{added, deleted, file, status}], `status` being git's
// letter for the file (A, M, D, T), read from --raw. treeNumstat is the same without it.
// NUL-separated, so a name with a tab, a quote or non-ASCII bytes is exact; renames off, so a rename into another
// path is the whole file added there and removed here. Both ids must be hex object ids, and follow --end-of-options.
// No external diff program and no textconv driver runs, whatever the repository or the user configures.
// A file git prints as binary (a real binary, a NUL byte, or text a .gitattributes `-diff` or `binary` line hides) is
// counted from the object store: the lines of its old blob as deleted and of its new blob as added. Exact for hidden
// text, an upper bound for a real binary (a floor of one line per 50 bytes, so binaries count toward the cap), and not
// dodgeable by an attribute the coder adds.
export function treeRows(root, from, to) {
  if (![from, to].every((id) => typeof id === 'string' && OBJECT_ID.test(id))) throw cannot('a recorded revision is not an object id');
  const list = (...format) => {
    try {
      return run(root, ['diff', ...format, '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--relative', '--ignore-submodules=none', '--end-of-options', from, to, '--', ...PATHSPEC], { encoding: 'utf8', maxBuffer: MAX_LISTING, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0');
    } catch (e) {
      if (e instanceof LoopExit) throw e;
      throw cannot(e.code === 'ENOBUFS' ? 'the changed-file listing is too large' : 'git diff failed');
    }
  };
  const raw = list('--raw', '--no-abbrev');
  const blobs = new Map(); // path -> [old blob id, new blob id]
  const letters = new Map(); // path -> status letter
  for (let i = 0; i + 1 < raw.length; i += 2) { // pairs of "<modes, ids, status>" and path: a name that starts with ':' is not mistaken for a record
    const [, , oldId, newId, letter] = raw[i].split(' ');
    blobs.set(raw[i + 1], [oldId, newId]);
    letters.set(raw[i + 1], letter);
  }
  const rows = list('--numstat').filter((t) => t !== '').map((t) => {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(t);
    if (!m) throw cannot('git printed a line this cannot read');
    return { added: m[1] === '-' ? null : Number(m[1]), deleted: m[2] === '-' ? null : Number(m[2]), file: m[3] };
  });
  const ids = rows.filter((r) => r.added === null).flatMap((r) => blobs.get(r.file) ?? []);
  const lines = blobLines(root, ids);
  return rows.map(({ added, deleted, file }) => {
    const status = letters.get(file);
    if (added !== null) return { added, deleted, file, status };
    const [o, n] = blobs.get(file) ?? [];
    return o === undefined || o === n ? { added: 0, deleted: 0, file, status } : { added: lines.get(n), deleted: lines.get(o), file, status };
  });
}
export const treeNumstat = (root, from, to) => treeRows(root, from, to).map(({ status, ...row }) => row);

// The changes the measurement leaves out because it excludes .somi and .claude, for the folders and files that carry agent policy:
// as { file, added: 0, deleted: 0, status } (no lines are counted), relative to `root`, the working tree against the commit
// `from`, untracked files (not ignored ones) as A. Read the way treeRows reads (renames off, so a file moved out of a guarded
// folder is a D here; submodules compared in full, so a `.gitmodules` `ignore` or `diff.ignoreSubmodules` cannot hide a moved or
// dirty one), and the index flags were refused by the measurement that precedes it. A gitlink in the index under .claude or at or
// under .somi is a row of its own (status G, which git never prints) when the diff did not list it: the measurement exempts both, so
// a submodule there is reachable, and an unchanged one still carries code the loop does not read. So is a nested repository at
// .somi (a .somi/.git), which hides .somi/config.json and .somi/rules from every listing here. The ignored files under the
// guarded names are compared with `before`, the snapshot taken at loop init (ignoredSnapshot): one that is new, changed or gone is a row.
const GUARDED = ['.claude', '.somi/config.json', '.somi/rules'];
// The ignored files the guard names, at any depth and in any case (a self-ignoring .CLAUDE/ is the policy folder on a case-insensitive filesystem).
const IGNORED_SPECS = ['**/.claude', '**/.claude/**', '**/claude.md', '**/claude.local.md', '**/agents.md', '**/.mcp.json', '**/.vscode/mcp.json', '.somi/config.json', '.somi/rules'].map((p) => `:(glob,icase)${p}`);
const DEPENDENCY_DIRS = new Set(['node_modules', 'vendor', 'bower_components', '.venv', 'venv', 'site-packages']);
const MAX_IGNORED = 256; // entries one snapshot stores by name; more are stored as one digest
const CHUNK_BYTES = 64 * 1024;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// A dependency folder (a shipped AGENTS.md is not this project's) puts a path out, unless a policy folder comes first: .claude/vendor/x.md is policy.
// Done here, not by an exclude pathspec, which could not tell the two apart.
const dependency = (file) => { for (const s of file.split('/')) { if (DEPENDENCY_DIRS.has(s)) return true; if (/^\.(claude|somi)$/i.test(s)) return false; } return false; };
// -> the file's sha-256, read in chunks; with a link followed: 'dangling' when the target is not there, 'special' when it is not a regular file.
// Without one, a non-regular file is a refusal (throws). Once the byte budget is spent a file is stood for by its size and change time (the size half is for readability: the change time already moves on every write).
// shortcut: that stand-in misses an edit that puts the change time back, so only a tree past LIMITS.snapshotBytes has it; raise the bound when one is reported.
function fileHash(full, follow, budget) {
  let fd;
  try { fd = fs.openSync(full, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (follow ? 0 : fs.constants.O_NOFOLLOW)); } catch (e) { // O_NONBLOCK: a FIFO is not waited on
    if (follow && ['ENOENT', 'ELOOP', 'ENOTDIR'].includes(e.code)) return 'dangling';
    throw e;
  }
  try {
    const st = fs.fstatSync(fd, { bigint: true });
    if (!st.isFile()) { if (follow) return 'special'; throw new Error('not a regular file'); }
    const h = crypto.createHash('sha256'); const buf = Buffer.alloc(CHUNK_BYTES);
    for (let n; budget.left >= 0 && (n = fs.readSync(fd, buf, 0, CHUNK_BYTES, null)) > 0;) { h.update(buf.subarray(0, n)); budget.left -= n; }
    return budget.left < 0 ? `s:${st.size}:${st.ctimeNs}` : h.digest('hex');
  } finally { fs.closeSync(fd); }
}
// A link is its text and, when its target is a regular file, that file too: an edit to the target (outside the guarded paths) is an edit to the policy.
function entryHash(full, budget) {
  if (!fs.lstatSync(full).isSymbolicLink()) return fileHash(full, false, budget);
  return `l:${fs.readlinkSync(full)}:${fileHash(full, true, budget)}`;
}
const POLICY_DIR = /(^|\/)\.(claude|vscode)(\/|$)|^\.somi(\/|$)/i;
const OVER = Object.freeze({ over: true, files: {} });
// The ignored files the guard names (a self-ignoring .claude/.gitignore, an ignored settings.local.json, a .vscode/mcp.json) with a content hash each,
// as { over, files, digest? }. A nested repository or worktree (git lists it as a directory) is the marker 'd:' and is not read, and a directory git could not open is the marker 'u:<errno text>'. Past MAX_IGNORED
// entries the names go into one digest, so a big tree still shows a change. over is true only for an entry that cannot be read or is not a regular
// file, and then every comparison raises (fails closed). Never throws but as a refusal from the pinned git.
export function ignoredSnapshot(root) {
  let out; let dirs = [];
  try { out = run(root, ['ls-files', '-o', '-i', '--exclude-standard', '-z', '--', ...IGNORED_SPECS], { encoding: 'utf8', maxBuffer: MAX_LISTING, stdio: ['ignore', 'pipe', 'pipe'], unlistable: true }); } catch (e) {
    if (!e.unlistable) { if (e instanceof LoopExit) throw e; throw cannot('git could not list the ignored files under the agent policy paths'); }
    ({ stdout: out, dirs } = e); // the rest of the listing is whole; each directory git could not open is an entry of its own
  }
  // A directory that is, holds or lies under a policy name stays over: what is planted in it cannot be seen. Any other is compared like a nested repository.
  if (dirs.some(({ dir }) => POLICY_DIR.test(dir))) return OVER;
  const names = out.split('\0').filter((t) => t !== '' && !dependency(t)).sort();
  const base = fs.realpathSync(root); const files = Object.create(null); const budget = { left: LIMITS.snapshotBytes };
  try {
    for (const f of names) files[f.replace(/\/$/, '')] = f.endsWith('/') ? 'd:' : entryHash(path.join(base, f), budget);
  } catch { return OVER; }
  for (const { dir, why } of dirs) files[dir] = `u:${shown(why)}`;
  return names.length + dirs.length > MAX_IGNORED ? { over: false, files: {}, digest: sha(JSON.stringify(Object.entries(files))) } : { over: false, files };
}
const marker = (v) => v === 'd:' || v?.startsWith('u:') === true;
const plainSnapshot = (v) => v !== null && typeof v === 'object' && typeof v.over === 'boolean' && v.files !== null && typeof v.files === 'object' && Object.values(v.files).every((h) => typeof h === 'string');
export function guardedRows(root, from, before) {
  if (typeof from !== 'string' || !OBJECT_ID.test(from)) throw cannot('a recorded revision is not an object id');
  const list = (args) => {
    try { return run(root, args, { encoding: 'utf8', maxBuffer: MAX_LISTING, stdio: ['ignore', 'pipe', 'pipe'], unlistable: true }).split('\0'); } catch (e) {
      if (e instanceof LoopExit) throw e;
      throw cannot('git could not list the changes to agent policy files');
    }
  };
  const raw = list(['diff', '--raw', '--no-abbrev', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--relative', '--ignore-submodules=none', '--end-of-options', from, '--', ...GUARDED]);
  const changed = [];
  for (let i = 0; i + 1 < raw.length; i += 2) changed.push({ file: raw[i + 1], added: 0, deleted: 0, status: raw[i].split(' ')[4] });
  const added = list(['ls-files', '-o', '--exclude-standard', '-z', '--', ...GUARDED]).filter((t) => t !== '').map((file) => ({ file, added: 0, deleted: 0, status: 'A' }));
  const listed = new Set(changed.map((r) => r.file));
  const links = list(['ls-files', '-s', '-z', '--', '.claude', '.somi']).filter((t) => t.startsWith('160000 ')).map((t) => t.slice(t.indexOf('\t') + 1))
    .filter((file) => !listed.has(file)).map((file) => ({ file, added: 0, deleted: 0, status: 'G' }));
  if (present(path.join(root, '.somi', '.git')) && !links.some((r) => r.file === '.somi')) links.push({ file: '.somi', added: 0, deleted: 0, status: 'G' });
  const ignored = [];
  if (before !== undefined) { // a state without a snapshot (a loop begun before this snapshot existed) is read as it always was: nothing new is raised
    const now = ignoredSnapshot(root);
    if (!plainSnapshot(before) || before.over || now.over) ignored.push({ file: '.claude', added: 0, deleted: 0, status: 'A' });
    else if (before.digest !== now.digest) ignored.push({ file: '.claude', added: 0, deleted: 0, status: 'M' }); // a tree stored as a digest: any change, or a change of kind, is one row
    else {
      for (const [file, hash] of Object.entries(now.files)) if (!Object.hasOwn(before.files, file) || before.files[file] !== hash) ignored.push({ file, added: 0, deleted: 0, status: Object.hasOwn(before.files, file) ? 'M' : 'A' });
      for (const file of Object.keys(before.files)) if (!Object.hasOwn(now.files, file)) ignored.push({ file, added: 0, deleted: 0, status: 'D' });
      // A nested repository or worktree, or a directory git cannot open, that appears, goes or changes hides what it holds (.vscode/mcp.json inside a `git init .vscode`): not named, so one row stands for it.
      if (ignored.some((r) => marker(now.files[r.file]) || marker(before.files[r.file]))) ignored.push({ file: '.claude', added: 0, deleted: 0, status: 'A' });
    }
  }
  return [...changed, ...added, ...links, ...ignored];
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
