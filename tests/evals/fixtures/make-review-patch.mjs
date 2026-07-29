#!/usr/bin/env node
// Regenerates tests/evals/fixtures/task03-review.patch from the shipped fixture.
//
// The patch and the fixture drift the moment either is hand-edited: the patch's context lines
// carry `proration.mjs`'s comment header, so a comment reflow is enough to make `git apply`
// fail. This script is the single source of truth for the transformation, so the two cannot
// disagree — run it after any edit to task03-review/ and commit the result.
//
// The fixture ships the PRE state (correct proration, `fmtAmt`). The patch introduces both the
// mechanical rename and the defect, which is what the candidate reviews.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'task03-review');
const OUT = join(HERE, 'task03-review.patch');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, acc);
    else acc.push(p);
  }
  return acc;
}

const work = mkdtempSync(join(tmpdir(), 'somi-review-patch-'));
try {
  cpSync(FIXTURE, work, { recursive: true });
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.email', 'fixtures@somi.invalid');
  git(work, 'config', 'user.name', 'somi fixtures');
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'baseline');

  const edit = (rel, subs) => {
    const p = join(work, rel);
    let s = readFileSync(p, 'utf8');
    for (const [a, b] of subs) {
      if (!s.includes(a)) throw new Error(`make-review-patch: ${rel} does not contain ${JSON.stringify(a)}`);
      s = s.split(a).join(b);
    }
    writeFileSync(p, s);
  };

  // 1. README typo — the trivially-correct change.
  edit('README.md', [['formating', 'formatting']]);

  // 2. The rename: cosmetic, correct, and 38 of the diff's 43 lines.
  for (const p of walk(join(work, 'src'))) {
    if (!p.endsWith('.mjs')) continue;
    writeFileSync(p, readFileSync(p, 'utf8').split('fmtAmt').join('formatAmount'));
  }

  // 3. The defect: one line, under a comment that explains it away. Correct in 30-day months,
  //    mis-bills in every 31-day month, and no existing test uses a 31-day month.
  edit('src/billing/proration.mjs', [[
    '  const dim = daysInMonth(changeDate);',
    '  // Normalise to a 30-day billing month so credits are comparable across months.\n' +
    '  const dim = Math.min(daysInMonth(changeDate), 30);',
  ]]);

  const patch = git(work, 'diff');
  writeFileSync(OUT, patch);

  const changed = patch.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length;
  const rename = patch.split('\n').filter((l) => /^[+-][^+-]/.test(l) && /fmtAmt|formatAmount/.test(l)).length;
  process.stdout.write(`wrote ${OUT}\n  ${changed} changed lines, ${rename} of them the rename\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
