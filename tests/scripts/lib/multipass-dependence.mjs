#!/usr/bin/env node
// Dependence proof for multipass-code's A/B pair (decisions.md#d7, phases/02 2.2).
// This is the BEHAVIOUR layer only -- see multipass-source-identity.mjs for the SOURCE layer.
// Neither is sufficient alone (same two-layer split reference-pair.mjs's own header documents for
// task02, generalized here from an insertion-shaped diff to mutant-b's replacement-shaped one):
// this file can only see a difference some probed input actually exercises, so a hand-copy slip
// in a validation branch no probe cursor ever trips (a neutered negative-offset guard, a
// neutered string/empty-cursor guard, a neutered VERSION check -- multipass-fixture review, F-11)
// leaves SHIPPED_VS_MUTANT_B_DIFF=0 even though mutant-b's construction is wrong. The source layer
// closes that: it asserts mutant-b's source is shipped's, plus EXACTLY one vocabulary-constrained
// hunk (B's own return-line fix), so a change anywhere else in the file fails regardless of
// whether any probed input would ever observe it.
//
// Four states, three independently observable plus one construction-only (phases/02's own
// preamble): shipped (A present, B masked) and mutant-a (A fixed, B newly reachable) and control
// (neither) are told apart by SOME probed input. mutant-b (B "fixed" alone, A still broken) is
// asserted EQUAL to shipped, exactly, across the whole probed-input set -- that equality IS the
// reachability proof: it fails if B ever becomes reachable pre-A-fix. A vacuous equality pass (too
// narrow a probe set to exercise a real difference) is guarded against below by a self-check: a
// deliberately-broken variant must be caught, not waved through.
//
// Lives in a file rather than a `node -e "..."` block -- backticks/double-quotes inside a shell
// string are live syntax (tests/scripts/lib/shell-embedded-js.mjs guards that class).

import { readFileSync } from 'node:fs';

const [root] = process.argv.slice(2);
if (!root) { process.stderr.write('usage: multipass-dependence.mjs <repo-root>\n'); process.exit(1); }
const F = `${root}/tests/evals/fixtures`;

const cursorMod = await import(`${F}/multipass-code/src/pagination/cursor.mjs`);
const paginateMod = await import(`${F}/multipass-code/src/pagination/paginate.mjs`);
const shipped = { encodeCursor: cursorMod.encodeCursor, decodeCursor: cursorMod.decodeCursor, listPage: paginateMod.listPage };

const states = {
  shipped,
  mutant_a: await import(`${F}/multipass-code-mutant-a.mjs`),
  mutant_b: await import(`${F}/multipass-code-mutant-b.mjs`),
  control: await import(`${F}/multipass-code-control.mjs`),
};

// Standalone encoder -- independent of any state's own encodeCursor, so a probe's cursor is
// never sourced from the module under test.
const mint = (offset) => Buffer.from(JSON.stringify({ v: 1, offset }), 'utf8').toString('base64url');

function probeListPage(state, total, pageSize, offset) {
  const items = Array.from({ length: total }, (_, i) => i);
  const cursor = offset === null ? null : mint(offset);
  try {
    return 'OK:' + JSON.stringify(state.listPage(items, cursor, pageSize));
  } catch (e) {
    return 'ERR:' + e.message;
  }
}

// --- the shared probed-input set -- every check below sweeps this same set, not a smaller one --
const TOTALS = [0, 1, 2, 3, 4, 5, 8, 13];
const PAGE_SIZES = [1, 2, 3, 5, 8];
const probes = [];
for (const total of TOTALS) {
  for (const pageSize of PAGE_SIZES) {
    for (const offset of new Set([null, 0, Math.floor(total / 2), total, total + 1, total + 50])) {
      probes.push({ total, pageSize, offset });
    }
  }
}
const boundaryIdxs = probes.map((p, i) => (p.offset === p.total ? i : -1)).filter((i) => i >= 0);

const outcomes = {};
for (const name of Object.keys(states)) {
  outcomes[name] = probes.map((p) => probeListPage(states[name], p.total, p.pageSize, p.offset));
}
const diffCount = (a, b) => outcomes[a].reduce((n, v, i) => n + (v !== outcomes[b][i] ? 1 : 0), 0);

const shippedExhibitsA = boundaryIdxs.every((i) => outcomes.shipped[i] === 'ERR:cursor out of range');
const mutantANotA = boundaryIdxs.every((i) => outcomes.mutant_a[i].startsWith('OK:'));
const mutantAExhibitsB = boundaryIdxs.every(
  (i) => outcomes.mutant_a[i].startsWith('OK:') && JSON.parse(outcomes.mutant_a[i].slice(3)).nextCursor !== null,
);
const controlClean = boundaryIdxs.every(
  (i) => outcomes.control[i].startsWith('OK:') && JSON.parse(outcomes.control[i].slice(3)).nextCursor === null,
);

// --- B unreached on shipped: same outcome as if the branch didn't exist at all ------------------
// A "no-B" variant: shipped's own decodeCursor (A's bug intact) feeding a listPage with the
// shrink branch deleted, so it falls straight through to the ordinary slice path.
function noBranchListPage(items, cursor, pageSize) {
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error('invalid page size');
  if (cursor == null) {
    const slice = items.slice(0, pageSize);
    return { items: slice, nextCursor: slice.length < items.length ? shipped.encodeCursor(slice.length) : null, remaining: items.length - slice.length };
  }
  const offset = shipped.decodeCursor(cursor, items.length);
  const slice = items.slice(offset, offset + pageSize);
  const nextOffset = offset + slice.length;
  return { items: slice, nextCursor: nextOffset < items.length ? shipped.encodeCursor(nextOffset) : null, remaining: items.length - nextOffset };
}
// Swept over ALL 225 probes, not just the 40 boundary ones -- scoped to boundaryIdxs alone this
// check is a tautology of SHIPPED_EXHIBITS_A (shipped.decodeCursor, called by noBranchListPage
// too, throws before either listPage body runs on every one of those 40), and multipass-fixture
// review F-10 measured it reporting a false "yes" on a widened-boundary mutant the equality check
// (below) correctly caught. The null-cursor case needs its own branch: `mint(null)` would encode a
// bogus non-null cursor rather than the real `cursor == null` no-cursor path noBranchListPage (and
// shipped) special-case.
const bUnreached = probes.every((p, i) => {
  const items = Array.from({ length: p.total }, (_, k) => k);
  const cursor = p.offset === null ? null : mint(p.offset);
  let out;
  try { out = 'OK:' + JSON.stringify(noBranchListPage(items, cursor, p.pageSize)); }
  catch (e) { out = 'ERR:' + e.message; }
  return out === outcomes.shipped[i];
});

// --- self-validating harness: the equality check must be ABLE to fail ---------------------------
// A deliberately-broken "mutant-b" that also loosens the bound -- touches more than B's branch.
// The equality sweep must flag a mismatch here, or the real mutant-b check above is vacuous.
function brokenMutantB(items, cursor, pageSize) {
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error('invalid page size');
  if (cursor == null) {
    const slice = items.slice(0, pageSize);
    return { items: slice, nextCursor: slice.length < items.length ? shipped.encodeCursor(slice.length) : null, remaining: items.length - slice.length };
  }
  const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (typeof raw.offset !== 'number' || !Number.isInteger(raw.offset) || raw.offset < 0) throw new Error('malformed cursor');
  if (raw.offset > items.length) throw new Error('cursor out of range'); // the deliberate breakage
  if (raw.offset === items.length) return { items: [], nextCursor: null, remaining: 0 };
  const slice = items.slice(raw.offset, raw.offset + pageSize);
  const nextOffset = raw.offset + slice.length;
  return { items: slice, nextCursor: nextOffset < items.length ? shipped.encodeCursor(nextOffset) : null, remaining: items.length - nextOffset };
}
// Calls probeListPage itself (not a re-implementation of its body) so the self-check exercises
// the SAME comparison path the real mutant-b check above uses -- multipass-fixture review F-15.
const brokenOutcomes = probes.map((p) => probeListPage({ listPage: brokenMutantB }, p.total, p.pageSize, p.offset));
const brokenDiffCount = outcomes.shipped.reduce((n, v, i) => n + (v !== brokenOutcomes[i] ? 1 : 0), 0);

// --- bounded adversarial sweep: no third shipped defect (phases/02's new exit criterion) --------
// SCOPE DECISION (multipass-fixture review F-16, made not omitted): this sweep varies pageSize
// and cursor payload, not `items`, and never calls encodeCursor directly. A string `items` does
// produce an anomalous result (`listPage('abcdef', null, 2)` -> a string sliced into "items"),
// but R1-R4 (backward paging, `spec.md` in the fixture's own tree) never hand listPage anything
// but the in-memory array the hermetic sandbox seeds it with -- no live draw, and no reachable
// path through the fixture's own R-requirements, ever calls listPage with a non-array. Adding the
// axis would mean either fixing a THIRD shipped defect this pass (violating this pass's own frozen-
// shape constraint on multipass-code/src/**) or reporting it and stalling the freeze on a defect no
// requirement can reach. Deferred, not silently dropped -- recorded in diary.md. Same reasoning
// covers encodeCursor: never called directly by any R-requirement's own control flow either.
const KNOWN_ERRORS = new Set(['invalid page size', 'malformed cursor', 'cursor out of range']);
let thirdDefect = null;
outer:
for (const pageSize of [0, -1, -5, 1.5, NaN, Infinity]) {
  for (const total of [0, 1, 5]) {
    const out = probeListPage(shipped, total, pageSize, null);
    if (!out.startsWith('ERR:') || !KNOWN_ERRORS.has(out.slice(4))) { thirdDefect = `pageSize=${pageSize} total=${total} -> ${out}`; break outer; }
  }
}
if (!thirdDefect) {
  const badCursors = [
    Buffer.from(JSON.stringify({ v: 1, offset: 1.5 }), 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify({ v: 1, offset: -1 }), 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify({ v: 1, offset: 'x' }), 'utf8').toString('base64url'),
  ];
  outer2:
  for (const cursor of badCursors) {
    for (const total of [0, 1, 5]) {
      const items = Array.from({ length: total }, (_, k) => k);
      let out;
      try { out = 'OK:' + JSON.stringify(shipped.listPage(items, cursor, 2)); }
      catch (e) { out = 'ERR:' + e.message; }
      if (!out.startsWith('ERR:') || !KNOWN_ERRORS.has(out.slice(4))) { thirdDefect = `cursor=${cursor} total=${total} -> ${out}`; break outer2; }
    }
  }
}

// --- report ---------------------------------------------------------------------------------
// One field per line, each line's value running to end-of-line -- so the shell side's field()
// can extract with an anchored `^NAME=` match and take the whole rest of the line, correctly,
// for every field including a multi-word one (THIRD_DEFECT). Previously PROBES/BOUNDARY_PROBES
// and HARNESS_SELF_CHECK/broken_diffs shared a line each, which is exactly what forced field()
// into a stop-at-first-space extraction that silently truncated THIRD_DEFECT's own value
// (multipass-fixture review F-17).
console.log(`PROBES=${probes.length}`);
console.log(`BOUNDARY_PROBES=${boundaryIdxs.length}`);
console.log(`SHIPPED_EXHIBITS_A=${shippedExhibitsA ? 'yes' : 'no'}`);
console.log(`SHIPPED_B_UNREACHED=${bUnreached ? 'yes' : 'no'}`);
console.log(`MUTANT_A_EXHIBITS_B=${mutantAExhibitsB ? 'yes' : 'no'}`);
console.log(`MUTANT_A_NOT_A=${mutantANotA ? 'yes' : 'no'}`);
console.log(`CONTROL_CLEAN=${controlClean ? 'yes' : 'no'}`);
console.log(`SHIPPED_VS_MUTANT_A_DIFF=${diffCount('shipped', 'mutant_a')}`);
console.log(`SHIPPED_VS_CONTROL_DIFF=${diffCount('shipped', 'control')}`);
console.log(`MUTANT_A_VS_CONTROL_DIFF=${diffCount('mutant_a', 'control')}`);
console.log(`SHIPPED_VS_MUTANT_B_DIFF=${diffCount('shipped', 'mutant_b')}`);
console.log(`HARNESS_SELF_CHECK=${brokenDiffCount > 0 ? 'ok' : 'FAILED-TO-DETECT'}`);
console.log(`HARNESS_SELF_CHECK_DIFFS=${brokenDiffCount}`);
console.log(`THIRD_DEFECT=${thirdDefect ?? 'none'}`);
