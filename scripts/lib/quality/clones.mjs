// quality/clones.mjs: copied code in what a change adds. Tokens come from the parse tree with names and literals normalised, so a copy
// with its variables renamed still matches (Type-1 and Type-2 clones). Short seed windows are matched first and then chained, with
// small gaps allowed, into one copied region, so a copy with a line changed or inserted is still one copy (a near-miss, Type-3 clone).
// A seed that also appears elsewhere, in the rest of the repository or in another part of the change, and more often than before the
// change, is copied. The copies of an access check that drifted apart on one task are exactly this.

import crypto from 'node:crypto';

const NAMES = new Set(['identifier', 'property_identifier', 'shorthand_property_identifier', 'shorthand_property_identifier_pattern', 'type_identifier', 'private_property_identifier', 'statement_identifier', 'field_identifier']);
const LITERALS = new Set(['string', 'template_string', 'number', 'regex', 'string_fragment',
  'string_literal', 'verbatim_string_literal', 'raw_string_literal', 'interpolated_string_expression', 'integer_literal', 'real_literal', 'character_literal']);

const FUNCTIONS = new Set(['function_declaration', 'function_expression', 'function', 'arrow_function', 'method_definition', 'generator_function_declaration', 'generator_function',
  'method_declaration', 'constructor_declaration', 'operator_declaration', 'conversion_operator_declaration', 'local_function_statement', 'lambda_expression', 'anonymous_method_expression', 'accessor_declaration']);

// A seed is this many tokens. Two seeds of one copy may be this far apart, and the copy may shift by this much against the original,
// which is a changed or inserted line or two. A copied region must still match this share of its tokens.
const SEED = 20;
const GAP = 20;
const SHIFT = 12;
const COVERAGE = 0.8;
// A seed found in more places than this is an idiom of the language or the codebase, not a copy of one piece of logic.
const COMMON = 24;

/**
 * [{ t, row }] for the code inside functions: names become ID, literals LIT, everything else its own text. Comments are dropped, and so
 * is code outside any function: a repeated config object or table is data, not the copied logic this looks for.
 */
export function tokensOf(tree) {
  const out = [];
  const visit = (n, inside) => {
    if (n.type === 'comment') return;
    const within = inside || FUNCTIONS.has(n.type);
    if (!within) { for (const c of n.children) visit(c, false); return; }
    if (LITERALS.has(n.type)) { out.push({ t: 'LIT', row: n.startPosition.row + 1 }); return; }
    if (n.childCount === 0) { if (n.text.trim() !== '') out.push({ t: NAMES.has(n.type) ? 'ID' : n.text, row: n.startPosition.row + 1 }); return; }
    for (const c of n.children) visit(c, true);
  };
  visit(tree.rootNode, false);
  return out;
}

const hash = (tokens) => crypto.createHash('sha1').update(tokens.map((x) => x.t).join('\u0001')).digest('base64');

/** Every window of `size` tokens: [{ hash, first, last, at }] with first and last rows. */
export function windows(tokens, size) {
  const out = [];
  for (let i = 0; i + size <= tokens.length; i++) out.push({ hash: hash(tokens.slice(i, i + size)), first: tokens[i].row, last: tokens[i + size - 1].row, at: i });
  return out;
}

const seedOf = (f) => Math.min(SEED, f.size);

function index(files) {
  const m = new Map();
  for (const f of files) {
    for (const w of windows(f.tokens, seedOf(f))) {
      const list = m.get(w.hash);
      if (list) list.push({ file: f.file, at: w.at }); else m.set(w.hash, [{ file: f.file, at: w.at }]);
    }
  }
  return m;
}

// Seeds of one file chained into regions. Each point is a seed at `at` matching `other` at `to`. A point joins a chain in the same other
// file when it follows closely and keeps about the same offset; otherwise it starts a new chain.
function chains(points, seed) {
  const open = [];
  for (const p of points.sort((a, b) => a.at - b.at)) {
    const delta = p.to - p.at;
    const chain = open.find((c) => c.other === p.other && p.at - c.last <= seed + GAP && Math.abs(delta - c.delta) <= SHIFT);
    if (chain) { chain.last = p.at; chain.lastTo = p.to; chain.delta = delta; chain.seeds.push(p.at); }
    else open.push({ other: p.other, first: p.at, firstTo: p.to, last: p.at, lastTo: p.to, delta, seeds: [p.at] });
  }
  return open;
}

function covered(seeds, seed) {
  let n = 0;
  let end = -1;
  for (const s of seeds) { n += Math.min(seed, s + seed - 1 - end); end = s + seed - 1; }
  return n;
}

// The regions of one file that copy something, at least `size` tokens long and mostly matching, one per stretch of the file.
function copiedRegions(f, isNew, places, others) {
  const seed = seedOf(f);
  const points = [];
  for (const w of windows(f.tokens, seed)) {
    const where = isNew(w.hash) ? places(w.hash) : [];
    if (where.length > COMMON) continue;
    for (const p of where) if (p.file !== f.file || Math.abs(p.at - w.at) >= f.size) points.push({ at: w.at, other: p.file, to: p.at });
  }
  const regions = chains(points, seed)
    .map((c) => ({ ...c, span: c.last + seed - c.first, cover: covered(c.seeds, seed) }))
    .filter((c) => c.span >= f.size && c.cover / c.span >= COVERAGE)
    .sort((a, b) => b.cover - a.cover);
  const kept = [];
  for (const r of regions) if (!kept.some((k) => r.first <= k.last + seed && k.first <= r.last + seed)) kept.push(r);
  return kept.map((r) => ({
    file: f.file, line: f.tokens[r.first].row, last: f.tokens[r.last + seed - 1].row,
    other: { file: r.other, line: others.get(r.other)?.tokens[r.firstTo]?.row ?? 1 },
    similarity: Number((r.cover / r.span).toFixed(2)),
  }));
}

/**
 * Copies a change made. A seed is a new copy when it occurs more often after the change than before it, which does not depend on how
 * git pairs the changed lines. after and before are the touched files in each version, rest the files the change did not touch; each is
 * [{ file, tokens, size }]. Returns one finding per copied region: { file, line, lines, other: { file, line }, similarity }.
 */
export function findClones({ after, before = [], rest = [] }) {
  const old = index([...before, ...rest]);
  const now = index([...after, ...rest]);
  const count = (m, h) => m.get(h)?.length ?? 0;
  const isNew = (h) => count(now, h) >= 2 && count(now, h) > count(old, h);
  const files = new Map([...rest, ...after].map((f) => [f.file, f]));
  const findings = after.flatMap((f) => copiedRegions(f, isNew, (h) => now.get(h), files));
  // Two copies that are both in the change would each be reported against the other: keep the later one.
  const mirrors = (x, y) => y.file === x.other.file && Math.abs(y.line - x.other.line) <= 1 && y.other.file === x.file && Math.abs(y.other.line - x.line) <= 1;
  const later = (x, y) => x.file > y.file || (x.file === y.file && x.line > y.line);
  return findings.filter((x) => !findings.some((y) => y !== x && mirrors(x, y) && later(y, x))).map(({ file, line, last, other, similarity }) => ({ file, line, lines: last - line + 1, other, similarity }));
}
