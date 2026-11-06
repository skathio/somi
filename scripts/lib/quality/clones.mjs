// quality/clones.mjs: copied code in what a change adds. Tokens come from the parse tree with names and literals normalised, so a copy
// with its variables renamed still matches (Type-1 and Type-2 clones). Every window of N tokens is hashed. An added window that also
// appears elsewhere, in the rest of the repository or in another part of the change, is a clone. The copies of an access check that
// drifted apart on one task are exactly this.

import crypto from 'node:crypto';

const NAMES = new Set(['identifier', 'property_identifier', 'shorthand_property_identifier', 'shorthand_property_identifier_pattern', 'type_identifier', 'private_property_identifier', 'statement_identifier', 'field_identifier']);
const LITERALS = new Set(['string', 'template_string', 'number', 'regex', 'string_fragment']);

/** [{ t, row }] for a tree: names become ID, literals LIT, everything else its own text. Comments are dropped. */
export function tokensOf(tree) {
  const out = [];
  const visit = (n) => {
    if (n.type === 'comment') return;
    if (LITERALS.has(n.type)) { out.push({ t: 'LIT', row: n.startPosition.row + 1 }); return; }
    if (n.childCount === 0) { if (n.text.trim() !== '') out.push({ t: NAMES.has(n.type) ? 'ID' : n.text, row: n.startPosition.row + 1 }); return; }
    for (const c of n.children) visit(c);
  };
  visit(tree.rootNode);
  return out;
}

const hash = (tokens) => crypto.createHash('sha1').update(tokens.map((x) => x.t).join('\u0001')).digest('hex');

/** Every window of `size` tokens: [{ hash, first, last }] with first and last rows. */
export function windows(tokens, size) {
  const out = [];
  for (let i = 0; i + size <= tokens.length; i++) out.push({ hash: hash(tokens.slice(i, i + size)), first: tokens[i].row, last: tokens[i + size - 1].row, at: i });
  return out;
}

function index(files) {
  const m = new Map();
  for (const f of files) for (const w of windows(f.tokens, f.size)) m.set(w.hash, [...(m.get(w.hash) ?? []), { file: f.file, w }]);
  return m;
}

// The runs of consecutive new-copy windows in one file, each with one other place the fragment occurs.
function copiedRuns(f, isNew, places) {
  const runs = [];
  let run = null;
  for (const w of windows(f.tokens, f.size)) {
    if (!isNew(w.hash)) { if (run) runs.push(run); run = null; continue; }
    if (run && w.at === run.end + 1) { run.end = w.at; run.last = w.last; continue; }
    if (run) runs.push(run);
    const other = places(w.hash).find((c) => c.file !== f.file || Math.abs(c.w.at - w.at) >= f.size);
    run = other ? { file: f.file, line: w.first, last: w.last, end: w.at, other: { file: other.file, line: other.w.first } } : null;
  }
  if (run) runs.push(run);
  return runs;
}

/**
 * Copies a change made. A fragment is a new copy when it occurs more often after the change than before it, which does not depend on
 * how git pairs the changed lines. after and before are the touched files in each version, rest the files the change did not touch;
 * each is [{ file, tokens, size }]. Returns one finding per run of copied windows: { file, line, lines, other: { file, line } }.
 */
export function findClones({ after, before = [], rest = [] }) {
  const old = index([...before, ...rest]);
  const now = index([...after, ...rest]);
  const count = (m, h) => m.get(h)?.length ?? 0;
  const isNew = (h) => count(now, h) >= 2 && count(now, h) > count(old, h);
  const findings = after.flatMap((f) => copiedRuns(f, isNew, (h) => now.get(h)));
  // Two copies that are both in the change would each be reported against the other: keep the later one.
  const mirrors = (x, y) => y.file === x.other.file && y.line === x.other.line && y.other.file === x.file && y.other.line === x.line;
  const later = (x, y) => x.file > y.file || (x.file === y.file && x.line > y.line);
  return findings.filter((x) => !findings.some((y) => y !== x && mirrors(x, y) && later(y, x))).map(({ file, line, last, other }) => ({ file, line, lines: last - line + 1, other }));
}
