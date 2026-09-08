#!/usr/bin/env node
// Source-identity proof for multipass-code's mutant-a, mutant-b, and control (decisions.md#d7,
// phases/02 2.2). This is the SOURCE layer -- see multipass-dependence.mjs for the BEHAVIOUR
// layer. Neither is sufficient alone: multipass-dependence.mjs's 225-probe equality/inequality
// sweeps can only see a difference SOME probed input actually exercises. Every probe cursor it
// mints is well-formed (`v:1`, a non-negative integer offset) by construction, so a hand-copy slip
// in a validation branch no probe ever trips -- a neutered negative-offset guard, a neutered
// string/empty-cursor guard, a neutered VERSION check -- all leave the behaviour layer's own
// diff counts unaffected (multipass-fixture review, F-11). This file closes that gap by asserting
// SOURCE identity instead of just behavioural identity, for all three hand-copied reference files:
// mutant-a is scored against draws (F-11's well-formed-probe argument is a property of the probe
// set, not of any one reference file -- multipass-fixture review pass 2, F-24), control likewise,
// and mutant-b (construction-only, never scored) keeps the coverage it already had.
//
// tests/scripts/lib/reference-pair.mjs already solved a version of this problem for task02's
// mutant/control pair (see that file's own header for the "absorbed anything written inside the
// matched region" incident this class of check exists to prevent) and its hunk-walking core is
// the technique this file generalizes -- but not the algorithm verbatim. reference-pair.mjs's walk
// assumes CONTROL IS MUTANT PLUS A PURE INSERTION (`if (i < mut.length && mut[i] === ctl[j])`
// only ever advances forward through an unbroken prefix match, i.e. every mutant line must appear,
// in order, inside the control). Each of this fixture's three reference files differs from the
// shipped source by one or more single-line REPLACEMENTs (A's bound check, B's return statement),
// never a pure insertion -- shipped's own line never reappears anywhere in the mutant, so an
// insertion-only walk would reject every legitimately-built reference file as "does not contain
// every line", never reaching a positive result. The walk below is a real (bidirectional)
// longest-common-subsequence diff, so it tolerates insertion, deletion, AND replacement, all
// collapsed into hunks the same way `diff -u` reports them; the discipline is otherwise identical
// to reference-pair.mjs's: exactly the expected number of contiguous hunks, each hunk a strict
// 1-for-1 line replacement (not a deletion, not a multi-line splice -- multipass-fixture review
// pass 2, F-19), every line in every hunk (both sides) constrained to a caller-supplied vocabulary.
//
// Lives in a file rather than a `node -e "..."` block -- backticks/double-quotes inside a shell
// string are live syntax (tests/scripts/lib/shell-embedded-js.mjs guards that class).

import { readFileSync } from 'node:fs';

// Same code-line filter reference-pair.mjs uses (blanks and comments excluded -- "the two files
// explain different things and should say so"), broadened to `/*` generally rather than the exact
// `/**` reference-pair.mjs checks (cursor.mjs uses single-line `/** ... */` JSDoc for
// encodeCursor -- `startsWith('/*')` alone misses it, and it has no counterpart in the reference
// files, which carry no JSDoc at all; measured directly by running this file before writing this
// comment).
//
// The `import` strip is applied to the SHIPPED side only (`stripImports: true`), not to any
// reference file's side (multipass-fixture review pass 2, F-20). It exists to absorb shipped's own
// `paginate.mjs -> cursor.mjs` import line, which has no counterpart in a self-contained reference
// file (mutant-a/mutant-b/control import nothing, the same convention task02-code-mutant.mjs uses
// for token.mjs) -- stripping it from the shipped side only is what makes that an EXPECTED
// structural difference rather than a spurious extra hunk. Stripping it from BOTH sides would also
// erase the evidence of an import line a reference file was never supposed to have: prepending one
// to a reference file previously passed silently (measured, F-20) because the old filter stripped
// it back out again before the diff ever ran.
const codeLines = (text, { stripImports = false } = {}) =>
  text
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
      if (stripImports && t.startsWith('import ')) return false;
      return true;
    });

export function readCodeLines(paths, opts) {
  return paths.flatMap((p) => codeLines(readFileSync(p, 'utf8'), opts));
}

// Real (bidirectional) LCS, computed by DP -- these files are tens of lines, so the O(n*m) table
// is trivial. Returns the matched (i, j) index pairs, in order.
function lcsPairs(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

// Collapse the gaps between consecutive LCS matches into hunks -- a gap on the `a` side alone is a
// pure deletion, on the `b` side alone a pure insertion, on both a replacement; consecutive gaps
// separated by at least one match are two DIFFERENT hunks, which is exactly the signal a change
// outside the one intended locus needs to trip.
function diffHunks(a, b) {
  const pairs = lcsPairs(a, b);
  const hunks = [];
  let ai = 0, bi = 0;
  for (const [pi, pj] of pairs) {
    if (ai < pi || bi < pj) hunks.push({ removed: a.slice(ai, pi), added: b.slice(bi, pj) });
    ai = pi + 1; bi = pj + 1;
  }
  if (ai < a.length || bi < b.length) hunks.push({ removed: a.slice(ai), added: b.slice(bi) });
  return hunks;
}

/**
 * @param {string[]} aLines  "before" code lines (e.g. shipped, concatenated across files)
 * @param {string[]} bLines  "after" code lines (e.g. mutant-a, mutant-b, or control)
 * @param {RegExp} vocab     every line inside every allowed hunk (both sides) must match
 * @param {number} expectedHunkCount  how many separate hunks this pair should differ by (mutant-a
 *   and mutant-b: 1 -- A's bound alone, or B's return alone; control: 2 -- both A's bound and B's
 *   return, since it fixes both loci -- multipass-fixture review pass 2, F-24)
 * @returns {string} 'ok', or a diagnostic string
 */
export function assertVocabHunks(aLines, bLines, vocab, expectedHunkCount = 1) {
  const hunks = diffHunks(aLines, bLines);
  if (hunks.length === 0) return 'files are identical -- no change at all (expected the fix(es) to be present)';
  if (hunks.length !== expectedHunkCount) {
    const locus = (h) => JSON.stringify((h.removed[0] ?? h.added[0] ?? '').trim());
    return `${hunks.length} separate hunks, not the expected ${expectedHunkCount}: ${hunks.map(locus).join(', ')}`;
  }
  for (const hunk of hunks) {
    // A 1-for-1 replacement only -- not a deletion (F-19: a hunk with `added.length === 0` means
    // the line was REMOVED, not fixed, and the vocabulary check below runs over
    // `[...removed, ...added]`, so a pure deletion of B's line would otherwise satisfy a
    // vocabulary built only from the two REPLACEMENT forms without ever containing a stray line).
    if (hunk.removed.length !== 1 || hunk.added.length !== 1) {
      return `a hunk is not a 1-for-1 replacement (${hunk.removed.length} removed, ${hunk.added.length} added): ` +
        JSON.stringify([...hunk.removed, ...hunk.added]);
    }
    const lines = [...hunk.removed, ...hunk.added];
    const stray = lines.find((l) => !vocab.test(l.trim()));
    if (stray !== undefined) return `the hunk contains a line outside the allowed vocabulary: ${JSON.stringify(stray.trim())}`;
  }
  return 'ok';
}

// --- A's own vocabulary: decodeCursor's bound check, before and after its fix -------------------
// Anchored at both ends against the trimmed line; admits exactly two literal strings (the shipped
// `>=` form and the fixed `>` form), nothing else that could plausibly appear in this file.
export const A_VOCAB = /^if \(payload\.offset (>=|>) total\) \{$/;

// --- B's own vocabulary: the shrink branch's return statement, before and after its fix ---------
// Anchored at both ends against the trimmed line; admits exactly two literal strings (shipped's
// re-minted cursor, the fixed `null`), nothing else that could plausibly appear in this file.
// Materially TIGHTER than the `EXPIRY_VOCAB` precedent it was previously compared to
// (multipass-fixture review pass 2, F-25): `EXPIRY_VOCAB` (`reference-pair.mjs:27`) is an
// unanchored prefix alternation that also admits a bare `}` or a bare `nowMs` anywhere in the
// file; this vocabulary admits only the two exact forms below, anchored start to end.
export const B_VOCAB = /^return \{ items: \[\], nextCursor: (encodeCursor\(offset\)|null), remaining: 0 \};$/;

// --- control's combined vocabulary: both loci, since control fixes A AND B ----------------------
// Derived from A_VOCAB/B_VOCAB (stripping each one's own start/end anchors, then re-anchoring the
// alternation as a whole) rather than restated as a fourth literal regex, so the two vocabularies
// can never drift out of sync with the combined one if either is ever edited.
const unanchoredBody = (re) => re.source.replace(/^\^/, '').replace(/\$$/, '');
export const AB_VOCAB = new RegExp(`^(?:${unanchoredBody(A_VOCAB)}|${unanchoredBody(B_VOCAB)})$`);

// --- CLI entry ------------------------------------------------------------------------------
const [cursorPath, paginatePath, mutantAPath, mutantBPath, controlPath] = process.argv.slice(2);
if (cursorPath && paginatePath && mutantAPath && mutantBPath && controlPath) {
  const shippedLines = readCodeLines([cursorPath, paginatePath], { stripImports: true });
  const mutantALines = readCodeLines([mutantAPath]);
  const mutantBLines = readCodeLines([mutantBPath]);
  const controlLines = readCodeLines([controlPath]);
  console.log(`MUTANT_A=${assertVocabHunks(shippedLines, mutantALines, A_VOCAB, 1)}`);
  console.log(`MUTANT_B=${assertVocabHunks(shippedLines, mutantBLines, B_VOCAB, 1)}`);
  console.log(`CONTROL=${assertVocabHunks(shippedLines, controlLines, AB_VOCAB, 2)}`);
}
