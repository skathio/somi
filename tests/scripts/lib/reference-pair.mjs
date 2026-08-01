#!/usr/bin/env node
// Asserts task02's mutant/control pair differ ONLY in expiry enforcement.
//
// Two layers, because neither is sufficient alone:
//   1. SOURCE  — the code-only diff must be exactly one contiguous insertion hunk, and every line
//                in it must belong to the expiry vocabulary.
//   2. BEHAVIOUR — cross-verified over well-formed AND malformed inputs.
//
// Layer 1 replaced a "locate the expiry block by regex and delete it" check. That shape absorbed
// anything written inside the matched region: the end anchor was the first `^ *}$`, so injecting
// `if (payload.sub === 'admin') throw new Error('bad signature');` above the expiry test was
// stripped along with it and passed at 38/38. A single-hunk assertion cannot absorb an extra
// statement anywhere, because an extra statement is either inside the hunk (caught by the
// vocabulary check) or makes a second hunk (caught by the count).
//
// Lives in a file rather than a `node -e "..."` block: those are shell-quoted context where a
// backtick is command substitution and a double quote ends the program. That has bitten once
// already, silently.

import { readFileSync } from 'node:fs';

const codeLines = (f) =>
  readFileSync(f, 'utf8')
    .split('\n')
    .filter((l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && t !== '/**'; });

const EXPIRY_VOCAB = /^(if \(typeof payload\.exp|throw new Error\('token expired'\);|\}|nowMs|&&)/;

const [mutFile, ctlFile] = process.argv.slice(2);
const mut = codeLines(mutFile);
const ctl = codeLines(ctlFile);

// Longest-common-subsequence-free: the control is the mutant plus an insertion, so walk both and
// collect maximal runs present in ctl but not mut, in order.
const hunks = [];
let i = 0, j = 0, cur = null;
while (j < ctl.length) {
  if (i < mut.length && mut[i] === ctl[j]) {
    if (cur) { hunks.push(cur); cur = null; }
    i++; j++;
  } else {
    (cur ??= []).push(ctl[j]);
    j++;
  }
}
if (cur) hunks.push(cur);

const out = (m) => { process.stdout.write(m); process.exit(0); };
if (i !== mut.length) out(`control does not contain every mutant line (diverged at mutant line ${i + 1}: ${JSON.stringify(mut[i])})`);
if (hunks.length === 0) out('control is identical to the mutant - it does not enforce expiry');
if (hunks.length > 1) out(`control adds ${hunks.length} separate hunks, not one: ${JSON.stringify(hunks.map((h) => h[0]))}`);

const stray = hunks[0].map((l) => l.trim()).filter((l) => !EXPIRY_VOCAB.test(l));
if (stray.length) out(`the added hunk contains non-expiry code: ${JSON.stringify(stray[0])}`);
out('ok');
