// Definition-set source resolution and on-disk path anchors, split out of run.mjs so every
// eval entrypoint can import them from lib/ without importing a sibling entrypoint (NFR-13).
// Moved verbatim apart from the two path anchors, which are one directory deeper here.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/**
 * Resolve `--source` to a directory holding the definition set, plus the SHA it came from.
 *
 * A path is used in place (SHA recorded as null — an unversioned source cannot be reproduced,
 * and the result file should say so rather than imply a commit). A git ref is checked out into a
 * detached worktree so the caller's working tree is never touched and two sets can be live at once.
 */
export function resolveSource(source, { repo = REPO } = {}) {
  if (source && (source.startsWith('/') || source.startsWith('.'))) {
    const dir = resolve(repo, source);
    if (!existsSync(dir)) throw new Error(`--source path does not exist: ${dir}`);
    return { dir, sha: null, ref: source, cleanup() {} };
  }
  const ref = source || 'HEAD';
  let sha;
  try {
    // stderr piped, not inherited: this is a probe, and a failed one is reported by the throw
    // below. Letting git's "fatal: Needed a single revision" through would make an expected
    // outcome look like a crash in any caller capturing output.
    sha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    throw new Error(`--source is neither an existing path nor a resolvable git ref: ${ref}`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'somi-eval-src-'));
  git(repo, 'worktree', 'add', '--detach', '--quiet', dir, sha);
  return {
    dir,
    sha,
    ref,
    cleanup() {
      // `worktree remove` first so git's metadata goes too; the rmSync is the belt for a
      // worktree git has already forgotten (a killed run leaves one behind).
      try { git(repo, 'worktree', 'remove', '--force', dir); } catch { /* fall through */ }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function shardDir(sha) {
  return join(HERE, '..', 'results', sha ?? 'unversioned');
}

export function fixtureFor(id, dir) {
  const base = join(dir, 'tests', 'evals', 'fixtures');
  const name = execFileSync('ls', [base], { encoding: 'utf8' }).split('\n')
    .find((n) => n.startsWith(`task${id}-`) && !n.endsWith('.mjs') && !n.endsWith('.patch'));
  if (!name) throw new Error(`no fixture for task ${id}`);
  return join(base, name);
}
