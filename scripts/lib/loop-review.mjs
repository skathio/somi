// loop-review.mjs -- what /code-loop's reviewer must see (which lens, which scope), decided from recorded state
// rather than from the reviewer's reading of evidence. Shared by scripts/somi-loop.mjs; no output of its own.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readRecord } from './tier-record.mjs';

// The sizing record decides the review lens: a work item that may handle untrusted input or touch auth, crypto,
// secrets or PII (security_lens in scripts/somi-tier.mjs's record) is reviewed with the security lens on every
// pass. No record, or a record without the flag, asks for nothing beyond the loop's configured mode.
export function reviewMinFor(root, slug) {
  return readRecord(root, slug)?.security_lens === true ? 'security' : null;
}

// The working tree as a git tree object: tracked and untracked files, .somi/ and .claude/ excluded, the same
// surface the diff cap measures. Built through a throwaway copy of the index so the caller's index is never
// touched (a copy rather than an empty index, so unchanged files are not re-hashed). -> tree id, or null.
export function snapshotTree(root) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-tree-'));
  const index = path.join(dir, 'index');
  try {
    const real = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-path', 'index'], { encoding: 'utf8' }).trim();
    if (fs.existsSync(real)) fs.copyFileSync(real, index);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    execFileSync('git', ['-C', root, 'add', '-A', '--', '.', ':(exclude).somi', ':(exclude).claude'], { env, stdio: 'ignore' });
    return execFileSync('git', ['-C', root, 'write-tree'], { env, encoding: 'utf8' }).trim();
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  const names = execFileSync('git', ['-C', root, 'diff', '--name-only', prev.tree, to], { encoding: 'utf8' });
  return { scope: 'delta', since_pass: prev.pass, from: prev.tree, to, files: names.split('\n').filter(Boolean) };
}
