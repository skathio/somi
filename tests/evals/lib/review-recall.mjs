// Reviewer-recall scoring, pure: parse a reviewer's text into findings, decide detection of a seeded
// defect by line overlap, compute recall / false-positive rate with a Wilson interval, apply the
// pre-registered GO / NO-GO table, and pick the case list from the mutant corpus with a seeded,
// stratified draw. The only I/O is selectCases reading the corpus directory. Reviewer output is
// hostile data: it is length-bounded, scanned in linear time (split and indexOf, no nested
// quantifiers), never evaluated, and only JSON.parse'd after a size check.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { wilson } from './stats.mjs';
import { mulberry32 } from './mann-whitney.mjs';

export const MAX_INPUT_CHARS = 200_000;
export const MAX_FINDINGS = 200;
export const OVERLAP_MARGIN = 2;
export const SEVERITIES = Object.freeze(['blocker', 'major', 'minor', 'nit']);
export const DETECTING = Object.freeze(['blocker', 'major']);
export const SAMPLE = Object.freeze({ MUTANTS: 40, PER_TASK_MAX: 8, CLEAN: 10 });
export const DEFAULT_SEED = 20261018;
export const CLEAN_VARIANTS = Object.freeze(['oracle', 'oracle2']);
const CLEAN_PER_TASK_MAX = 2;

const MAX_LINE_NO = 10_000_000;
const SEVERITY_WINDOW = 40; // a severity word opens a finding block only near the start of a line
const SPLIT = /[\s()[\]`'"*,;<>|]+/;
const SEVERITY_WORD = /\b(blocker|major|minor|nit)\b/i;
const HEADING = /^\s*(?:#{1,6}\s|-{3,}\s*$)/;

const lineNo = (v) => {
  const n = typeof v === 'string' && /^\d{1,8}$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) && n >= 1 && n <= MAX_LINE_NO ? n : null;
};

const normSeverity = (s) => {
  if (typeof s !== 'string') return null;
  const t = s.trim().toLowerCase();
  return SEVERITIES.includes(t) ? t : null;
};

function makeFinding(file, a, b, severity) {
  const start = lineNo(a);
  const end = b === undefined || b === null ? start : lineNo(b);
  if (typeof file !== 'string' || file.length === 0 || file.length > 256 || start === null || end === null) return null;
  return { file, lineStart: Math.min(start, end), lineEnd: Math.max(start, end), severity };
}

// "path/file.ext:12", "file.ext:12-18", "file.ext:12:5" (trailing punctuation tolerated).
function refFromToken(token, severity) {
  let end = token.length;
  while (end > 0 && '.:,;)!?'.includes(token[end - 1])) end--;
  if (end === 0) return null;
  const parts = token.slice(0, end).split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const file = parts[0];
  if (!file.includes('.') && !file.includes('/')) return null;
  const m = /^(\d{1,8})(?:[-–](\d{1,8}))?$/.exec(parts[1]);
  return m ? makeFinding(file, m[1], m[2], severity) : null;
}

function parseText(text) {
  const out = [];
  let block = null; // severity of the finding block currently open
  for (const line of text.split('\n')) {
    const head = SEVERITY_WORD.exec(line.slice(0, SEVERITY_WINDOW));
    if (head) block = head[1].toLowerCase();
    else if (HEADING.test(line)) block = null;
    const any = SEVERITY_WORD.exec(line);
    for (const tok of line.split(SPLIT)) {
      if (!tok.includes(':')) continue;
      const f = refFromToken(tok, head ? block : any ? any[1].toLowerCase() : block);
      if (f) out.push(f);
    }
  }
  return out;
}

function fromJsonValue(v) {
  const list = Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray(v.findings) ? v.findings : null;
  if (!list) return [];
  const out = [];
  for (const it of list.slice(0, MAX_FINDINGS + 1)) {
    if (!it || typeof it !== 'object') continue;
    const file = it.file ?? it.path;
    let a = it.lineStart ?? it.line_start ?? it.start ?? it.line;
    let b = it.lineEnd ?? it.line_end ?? it.end;
    if (typeof a === 'string' && b === undefined) {
      const m = /^(\d{1,8})\s*[-–]\s*(\d{1,8})$/.exec(a.trim());
      if (m) { a = m[1]; b = m[2]; }
    }
    const f = makeFinding(file, a, b, normSeverity(it.severity));
    if (f) out.push(f);
  }
  return out;
}

function parseJson(text) {
  const candidates = [text.trim()];
  let from = 0;
  for (let i = 0; i < 5; i++) {
    const open = text.indexOf('```', from);
    if (open === -1) break;
    const nl = text.indexOf('\n', open);
    if (nl === -1) break;
    const close = text.indexOf('```', nl);
    if (close === -1) break;
    candidates.push(text.slice(nl + 1, close).trim());
    from = close + 3;
  }
  for (const c of candidates) {
    if (c[0] !== '[' && c[0] !== '{') continue;
    try {
      const found = fromJsonValue(JSON.parse(c));
      if (found.length > 0) return found;
    } catch { /* not JSON: the text parser is the fallback */ }
  }
  return [];
}

/**
 * Parse a reviewer output into findings. Returns { findings, unparsed, truncated, capped }.
 * `unparsed` is true when nothing was parsed (which includes a legitimate "no issues" answer: the
 * caller keeps the raw text and decides). A finding's severity is null when none could be tied to it.
 */
export function parseFindings(output) {
  const raw = typeof output === 'string' ? output : '';
  const truncated = raw.length > MAX_INPUT_CHARS;
  const text = truncated ? raw.slice(0, MAX_INPUT_CHARS) : raw;
  let findings = parseJson(text);
  if (findings.length === 0) findings = parseText(text);
  const capped = findings.length > MAX_FINDINGS;
  if (capped) findings = findings.slice(0, MAX_FINDINGS);
  return { findings, unparsed: findings.length === 0, truncated, capped };
}

const norm = (p) => p.replace(/\\/g, '/').replace(/^(?:\.\/|[ab]\/)+/, '');

/** Same file when equal, or one is a path-segment suffix of the other (reviewers shorten paths). */
export function sameFile(cited, target) {
  const a = norm(cited);
  const b = norm(target);
  return a === b || a.endsWith('/' + b) || b.endsWith('/' + a);
}

/** Inclusive overlap of [ls, le] with the mutated range widened by the margin on both sides. */
export function overlaps(ls, le, mutStart, mutEnd, margin = OVERLAP_MARGIN) {
  return ls <= mutEnd + margin && le >= mutStart - margin;
}

/** Score one mutant case: detected = a Blocker/Major finding in the mutated file overlapping the lines. */
export function scoreMutant(output, mutated) {
  const p = parseFindings(output);
  const detected = p.findings.some((f) => DETECTING.includes(f.severity) && sameFile(f.file, mutated.file) && overlaps(f.lineStart, f.lineEnd, mutated.start, mutated.end));
  return { kind: 'mutant', detected, unparsed: p.unparsed };
}

/** Score one clean case: a false positive is any Blocker or Major finding, wherever it points. */
export function scoreClean(output) {
  const p = parseFindings(output);
  return { kind: 'clean', falsePositive: p.findings.some((f) => DETECTING.includes(f.severity)), unparsed: p.unparsed };
}

/** Wilson 95% interval for k of n, or null outside the domain. */
export function wilson95(k, n) {
  return wilson(k, n, 1.96);
}

// Thresholds as exact fractions so a boundary value is decided in integers, never by float rounding.
const T = Object.freeze({ R_LIMITED: [1, 5], R_GO: [9, 20], DIFF_MIN: [1, 10], DIFF_GO: [1, 4] });

/**
 * Pre-registered branch table. NO-GO if R < 0.20 or R - FPR < 0.10; LIMITED-GO if 0.20 <= R < 0.45
 * (and R - FPR >= 0.10); GO if R >= 0.45 and R - FPR >= 0.25. R >= 0.45 with 0.10 <= R - FPR < 0.25
 * falls in no registered branch: it is returned as UNDEFINED so a person decides, never defaulted.
 */
export function branchFor(k, n, f, m) {
  const ge = (num, den, [a, b]) => num * b >= a * den; // num/den >= a/b, all integers
  const diffNum = k * m - f * n; // (R - FPR) = diffNum / (n * m)
  const diffDen = n * m;
  if (!ge(k, n, T.R_LIMITED) || !ge(diffNum, diffDen, T.DIFF_MIN)) return 'NO-GO';
  if (!ge(k, n, T.R_GO)) return 'LIMITED-GO';
  return ge(diffNum, diffDen, T.DIFF_GO) ? 'GO' : 'UNDEFINED';
}

/**
 * Summarise scored rows ({kind:'mutant', detected} / {kind:'clean', falsePositive}).
 * Returns null unless there is at least one row of each kind and every row is well formed.
 */
export function recallStats(rows) {
  if (!Array.isArray(rows)) return null;
  let n = 0, k = 0, m = 0, f = 0, unparsed = 0;
  for (const r of rows) {
    if (!r || typeof r !== 'object') return null;
    if (r.kind === 'mutant' && typeof r.detected === 'boolean') { n++; if (r.detected) k++; }
    else if (r.kind === 'clean' && typeof r.falsePositive === 'boolean') { m++; if (r.falsePositive) f++; }
    else return null;
    if (r.unparsed === true) unparsed++;
  }
  if (n === 0 || m === 0) return null;
  const R = k / n;
  const FPR = f / m;
  return { n, k, m, f, R, FPR, diff: R - FPR, interval: wilson95(k, n), fprInterval: wilson95(f, m), unparsed, branch: branchFor(k, n, f, m) };
}

/** Mutated line range (1-based, in the mutated file) of applying find -> replace once; null if find is not unique. */
export function mutatedRange(original, find, replace) {
  if (typeof find !== 'string' || find.length === 0 || original.split(find).length !== 2) return null;
  const mutated = original.replace(find, () => replace);
  if (mutated === original) return null;
  const a = original.split('\n');
  const b = mutated.split('\n');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const start = p + 1;
  const end = b.length - s; // pure deletion: end < start, so anchor on the lines either side of the join
  return end >= start ? { start, end } : { start: Math.max(1, p), end: p + 1 };
}

function shuffled(list, rnd) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Split `total` over buckets with the given capacities: even shares, remainder to the buckets that
// come first in `order`, never above a capacity; leftover from capped buckets is redistributed.
function allocate(total, caps, order) {
  const alloc = new Map(order.map((t) => [t, 0]));
  let left = total;
  while (left > 0) {
    const open = order.filter((t) => alloc.get(t) < caps.get(t));
    if (open.length === 0) break;
    for (const t of open) {
      if (left === 0) break;
      alloc.set(t, alloc.get(t) + 1);
      left--;
    }
  }
  return alloc;
}

/**
 * Seeded stratified draw from <corpusDir>/<task>.mutants.json: 40 mutants (at most 8 per task, shares
 * as even as the corpus allows) and 10 clean cases (a task's whole unmutated solution, `oracle` or `oracle2`, one per
 * task before any task repeats, at most 2 per task). Same corpus and seed give the same list; the mutant draw does not
 * depend on the clean draw. Returns { seed, mutants: [{task, name, file, start, end}], clean: [{task, variant}] }.
 */
export function selectCases(corpusDir, seed = DEFAULT_SEED) {
  const rnd = mulberry32(seed);
  const tasks = readdirSync(corpusDir).filter((n) => n.endsWith('.mutants.json')).map((n) => n.slice(0, -'.mutants.json'.length)).sort();
  const pools = new Map();
  const variants = new Map();
  for (const task of tasks) {
    const list = JSON.parse(readFileSync(join(corpusDir, `${task}.mutants.json`), 'utf8'));
    const pool = [];
    for (const mu of Array.isArray(list) ? list : []) {
      const path = join(corpusDir, task, 'oracle', String(mu.file));
      if (!existsSync(path)) continue;
      const range = mutatedRange(readFileSync(path, 'utf8'), mu.find, mu.replace);
      if (range) pool.push({ task, name: mu.name, file: mu.file, ...range });
    }
    if (pool.length > 0) pools.set(task, pool);
    variants.set(task, CLEAN_VARIANTS.filter((v) => existsSync(join(corpusDir, task, v)) && readdirSync(join(corpusDir, task, v)).length > 0));
  }
  const order = shuffled([...pools.keys()], rnd);
  const caps = new Map(order.map((t) => [t, Math.min(SAMPLE.PER_TASK_MAX, pools.get(t).length)]));
  const alloc = allocate(SAMPLE.MUTANTS, caps, order);
  const mutants = [];
  for (const t of [...pools.keys()].sort()) mutants.push(...shuffled(pools.get(t), rnd).slice(0, alloc.get(t)));

  // Clean cases are whole-task diffs: the fixture against a complete correct solution. Each task offers up to two distinct ones
  // (the reference solution and the independent second solution); no task is used more than twice and none is repeated.
  const cleanOrder = shuffled([...variants.keys()].filter((t) => variants.get(t).length > 0), rnd);
  const queues = new Map(cleanOrder.map((t) => [t, shuffled(variants.get(t), rnd)]));
  const clean = [];
  for (let round = 0; round < CLEAN_PER_TASK_MAX && clean.length < SAMPLE.CLEAN; round++) {
    for (const t of cleanOrder) {
      const q = queues.get(t);
      if (round < q.length && clean.length < SAMPLE.CLEAN) clean.push({ task: t, variant: q[round] });
    }
  }
  return { seed, mutants, clean };
}
