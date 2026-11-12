// quality/clones.mjs: copied code in what a change adds. Tokens come from the parse tree with names and literals normalised, so a copy
// with its variables renamed still matches (Type-1 and Type-2 clones). Whole windows of the full size find exact copies. Short seed
// windows are also chained, with small gaps allowed, into one copied region, so a copy with a line changed or inserted is still one copy
// (a near-miss, Type-3 clone).
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
// A seed found in more places than this before the change is an idiom of the language or the codebase, not a copy of one piece of
// logic. It is judged before the change, so making many copies at once cannot turn the copies into an idiom. Only this many of a seed's
// places are chained, which bounds the work and is enough to find one original.
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

function index(files, sizeOf) {
  const m = new Map();
  for (const f of files) {
    for (const w of windows(f.tokens, sizeOf(f))) {
      const list = m.get(w.hash);
      if (list) list.push({ file: f.file, at: w.at }); else m.set(w.hash, [{ file: f.file, at: w.at }]);
    }
  }
  return m;
}

// Whether a window is a new copy: it occurs at least twice after the change, and more often than before it.
function counter(files) {
  const { after, before, rest, sizeOf } = files;
  const old = index([...before, ...rest], sizeOf);
  const now = index([...after, ...rest], sizeOf);
  const count = (m, h) => m.get(h)?.length ?? 0;
  return { isNew: (h) => count(now, h) >= 2 && count(now, h) > count(old, h), isIdiom: (h) => count(old, h) > COMMON, places: (h) => now.get(h) ?? [] };
}

// Whole copies: runs of consecutive new windows of the full size, each with one other place it occurs. A window this long is not an
// idiom, so every copy is found however many there are.
function exactRuns(f, { isNew, places }) {
  const runs = [];
  let run = null;
  for (const w of windows(f.tokens, f.size)) {
    if (run && isNew(w.hash) && w.at === run.end + 1) { run.end = w.at; continue; }
    if (run) runs.push(run);
    const other = isNew(w.hash) ? places(w.hash).find((c) => c.file !== f.file || Math.abs(c.at - w.at) >= f.size) : null;
    run = other ? { first: w.at, end: w.at, other: other.file, to: other.at } : null;
  }
  if (run) runs.push(run);
  return runs.map((r) => ({ first: r.first, last: r.end + f.size - 1, other: r.other, to: r.to, similarity: 1 }));
}

// Seeds of one file chained into regions. Each point is a seed at `at` matching `other` at `to`. A point joins a chain in the same other
// file when it follows closely and keeps about the same offset; otherwise it starts a new chain. A chain left too far behind is closed,
// so each point is compared only with the chains still open near it.
function chains(points, seed) {
  const open = new Map();
  const done = [];
  for (const p of points.sort((a, b) => a.at - b.at)) {
    const delta = p.to - p.at;
    const live = (open.get(p.other) ?? []).filter((c) => p.at - c.last <= seed + GAP || !done.push(c));
    const chain = live.find((c) => Math.abs(delta - c.delta) <= SHIFT);
    if (chain) { chain.last = p.at; chain.delta = delta; chain.seeds.push(p.at); }
    else live.push({ other: p.other, first: p.at, firstTo: p.to, last: p.at, delta, seeds: [p.at] });
    open.set(p.other, live);
  }
  return [...done, ...[...open.values()].flat()];
}

function covered(seeds, seed) {
  let n = 0;
  let end = -1;
  for (const s of seeds) { n += Math.min(seed, s + seed - 1 - end); end = s + seed - 1; }
  return n;
}

// Near copies: seeds chained into regions at least `size` tokens long that mostly match.
function nearRegions(f, { isNew, isIdiom, places }) {
  const seed = seedOf(f);
  const points = [];
  for (const w of windows(f.tokens, seed)) {
    if (!isNew(w.hash) || isIdiom(w.hash)) continue;
    const where = places(w.hash).filter((p) => p.file !== f.file || Math.abs(p.at - w.at) >= f.size).slice(0, COMMON);
    for (const p of where) points.push({ at: w.at, other: p.file, to: p.at });
  }
  return chains(points, seed)
    .map((c) => ({ first: c.first, last: c.last + seed - 1, other: c.other, to: c.firstTo, span: c.last + seed - c.first, cover: covered(c.seeds, seed) }))
    .filter((c) => c.span >= f.size && c.cover / c.span >= COVERAGE)
    .map((c) => ({ ...c, similarity: Number((c.cover / c.span).toFixed(2)) }));
}

// One finding per stretch of a file, the longest region first, so a near copy that holds an exact stretch is reported whole.
function copiedRegions(f, { exact, near, others }) {
  const kept = [];
  const candidates = [...exactRuns(f, exact), ...nearRegions(f, near)].sort((a, b) => (b.last - b.first) - (a.last - a.first));
  for (const r of candidates) if (!kept.some((k) => r.first <= k.last && k.first <= r.last)) kept.push(r);
  return kept.map((r) => ({ file: f.file, line: f.tokens[r.first].row, last: f.tokens[r.last].row, other: { file: r.other, line: others.get(r.other)?.tokens[r.to]?.row ?? 1 }, similarity: r.similarity }));
}

/**
 * Copies a change made. A window is a new copy when it occurs more often after the change than before it, which does not depend on how
 * git pairs the changed lines. after and before are the touched files in each version, rest the files the change did not touch; each is
 * [{ file, tokens, size }]. Returns one finding per copied region: { file, line, lines, other: { file, line }, similarity }.
 */
export function findClones({ after, before = [], rest = [] }) {
  const exact = counter({ after, before, rest, sizeOf: (f) => f.size });
  const near = counter({ after, before, rest, sizeOf: seedOf });
  const others = new Map([...rest, ...after].map((f) => [f.file, f]));
  const findings = after.flatMap((f) => copiedRegions(f, { exact, near, others }));
  // Two copies that are both in the change would each be reported against the other: keep the later one.
  const mirrors = (x, y) => y.file === x.other.file && Math.abs(y.line - x.other.line) <= 1 && y.other.file === x.file && Math.abs(y.other.line - x.line) <= 1;
  const later = (x, y) => x.file > y.file || (x.file === y.file && x.line > y.line);
  return findings.filter((x) => !findings.some((y) => y !== x && mirrors(x, y) && later(y, x))).map(({ file, line, last, other, similarity }) => ({ file, line, lines: last - line + 1, other, similarity }));
}
