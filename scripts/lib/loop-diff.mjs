// loop-diff.mjs -- the code loop's diff measurement: the weighted cumulative diff of the working tree against the
// loop's baseline, untracked files included. Moved out of scripts/somi-loop.mjs unchanged.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Untracked, non-ignored files as synthetic `--numstat` rows (all lines added).
// `git diff` reads the index and the work tree, but a file git has never been
// told about is in neither -- so a brand-new file counts ZERO until someone runs
// `git add`. That made the cap under-measure by the entire size of every new
// file an iteration introduced, silently, in the direction that lets work
// through (measured 248 against a true 503 on one real iteration).
// Enumerated separately and merged into the same stream rather than fixed with
// `git add -N`, which would mutate the caller's index as a side effect of a
// read-only query.
export function untrackedNumstat(root, pathspec) {
  let listed = '';
  try {
    listed = execFileSync(
      'git',
      ['-C', root, 'ls-files', '--others', '--exclude-standard', '--', ...pathspec],
      { encoding: 'utf8' },
    );
  } catch (e) {
    listed = e.stdout ? e.stdout.toString() : '';
  }
  const rows = [];
  for (const file of listed.split('\n')) {
    if (file === '') continue;
    let buf;
    try {
      buf = fs.readFileSync(path.join(root, file));
    } catch {
      continue; // raced away between listing and reading
    }
    // git calls a blob binary on a NUL in the first 8000 bytes and reports `-`.
    if (buf.subarray(0, 8000).includes(0)) {
      rows.push(`-\t-\t${file}`);
      continue;
    }
    const text = buf.toString('utf8');
    const added = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    rows.push(`${added}\t0\t${file}`);
  }
  return rows.join('\n');
}

// Weighted cumulative diff vs baseline. Out-of-scope lines count double.
// Covers tracked changes, staged changes, AND untracked files (see above) --
// the whole working tree, which is what the cap is meant to bound.
export function computeDiff(root, baseline, iterationFiles) {
  const pathspec = ['.', ':(exclude).somi', ':(exclude).claude'];
  let output = '';
  try {
    output = execFileSync(
      'git',
      ['-C', root, 'diff', '--numstat', baseline, '--', ...pathspec],
      { encoding: 'utf8' },
    );
  } catch (e) {
    output = e.stdout ? e.stdout.toString() : '';
  }
  const untracked = untrackedNumstat(root, pathspec);
  if (untracked !== '') output = output === '' ? untracked : `${output}\n${untracked}`;
  let total = 0;
  let weighted = 0;
  const outOfScope = [];
  for (const line of output.split('\n')) {
    if (line === '') continue;
    const parts = line.split('\t');
    let added = parts[0];
    let deleted = parts[1];
    const file = parts.slice(2).join('\t');
    if (!file) continue;
    added = added === '-' ? 0 : Number(added); // binary
    deleted = deleted === '-' ? 0 : Number(deleted);
    const lines = added + deleted;
    total += lines;
    let inScope = false;
    for (const entry of iterationFiles) {
      if (!entry) continue;
      if (file === entry || (entry.endsWith('/') && file.startsWith(entry))) {
        inScope = true;
        break;
      }
    }
    if (inScope) {
      weighted += lines;
    } else {
      weighted += 2 * lines;
      outOfScope.push(file);
    }
  }
  return { total, weighted, outOfScope };
}
