// quality/gate.mjs: whether a change meets the quality limits. It scores only what the change touches, against the version before it,
// so an old codebase is not failed on day one: a change may not take a function or a file over a limit, and a file may not gain more
// complexity in one change than its per-change limit, which is what stops a function being split apart just to pass. A function that
// was already over and got worse is reported as a warning. Copied code, stylesheet rules and newly added suppressions are checked in
// what the change added, and so are Python's leftover debugging, swallowed errors and exports nothing imports. A change the parser cannot follow fails, because a change that cannot be measured must not pass as clean.

import crypto from 'node:crypto';
import { TEST_FILE } from '../signals.mjs';
import { addedRanges, filesAt, oldLine, renamedFiles } from '../git-tree.mjs';
import { findClones, tokensOf } from './clones.mjs';
import { scoreCoupling } from './coupling.mjs';
import { aliasesFrom } from './path-aliases.mjs';
import { exportsAdded } from './exports.mjs';
import { cssRules } from './css.mjs';
import { report, overlaps } from './findings.mjs';
import { pairUnits, scoreUnit } from './functions.mjs';
import { codeLines, unitsOf, topLevelCognitive } from './metrics.mjs';
import { languageOf, parseSource } from './parse.mjs';
import { scorePython, scoreUnusedExports } from './python.mjs';
import { scoreSlop } from './slop.mjs';
import { scoreComments, scoreLines } from './suppressions.mjs';
import { keyOf, scoreTotals } from './totals.mjs';

export { exemption, METRICS, MAX_EXEMPTION_DAYS } from './functions.mjs';
export { scoreComments } from './suppressions.mjs';

// Code that is not the product: dependencies, build output, test data, and docs, examples and playgrounds, which are written to be
// read once.
const SKIPPED = /(^|\/)(node_modules|vendor|dist|build|coverage|\.next|\.somi|fixtures?|__fixtures__|testdata|test-data|docs?|examples?|demos?|playgrounds?)\//;
const MINIFIED = /\.min\.(js|css)$/;
const GENERATED = /@generated\b|Code generated .* DO NOT EDIT/;
// Source files in a language the gate has no grammar for. A change made only of these passes with nothing scored, so it says so.
const UNCOVERED = /\.(go|rs|java|kt|kts|rb|php|swift|scala|c|cc|cpp|cxx|h|hpp|m|mm|dart|lua|ex|exs|clj|fs|vb|sh|ps1|sql|vue|svelte)$/i;
export const JS_FAMILY = new Set(['javascript', 'typescript', 'tsx']);
// Copies are compared within one family of languages: JavaScript with TypeScript, C# with C#, and Python with Python.
const FAMILIES = { 'c-sharp': 'cs', python: 'py' };
export const familyOf = (language) => (JS_FAMILY.has(language) ? 'js' : FAMILIES[language] ?? null);
const MAX_REPO_FILES = 3000;
const MAX_GRAPH_FILES = 10000;
export const TOO_DEEP = 'nested too deeply to measure';

const touches = (unit, ranges) => overlaps(ranges, unit.start, unit.end);
// The review signals' test pattern, and two more the calibration found: .NET test projects (src/UnitTests/, Foo.Tests/) and a file named
// test.ts beside the code it tests.
const MORE_TESTS = /(^|\/)[^/]*Tests?\/|Tests?\.cs$|(^|\/)(test|spec)\.[^/]+$/;
export const isTest = (file) => TEST_FILE.test(file) || MORE_TESTS.test(file);
/** Why a file is not scored: its folder, a minified name, or a generated marker in its first lines. Null when it is scored. */
function skipReason(file, text) {
  if (SKIPPED.test(file)) return 'folder';
  if (MINIFIED.test(file)) return 'minified';
  return GENERATED.test(text.split('\n').slice(0, 5).join('\n')) ? 'generated' : null;
}
export const skipped = (file, text) => skipReason(file, text) !== null;
export const total = (units, top) => units.reduce((s, u) => s + u.cognitive, 0) + top;
const totalsOf = (tree, units) => ({ cognitive: total(units, topLevelCognitive(tree)), lines: codeLines(tree), functions: units.length });

// No skip holds in a benchmark: an agent must not pass by writing a generated marker, by putting its code under examples/, or by adding
// it to a file that was skipped already. Only what the change added is new there, so the old code of such a file fails nothing. In a
// project the skip holds, and is reported, so a person sees what was not scored.
function skipFile(ctx, file, text) {
  const reason = skipReason(file, text);
  if (!reason || ctx.mode === 'benchmark') return false;
  ctx.skipped.push({ file, reason });
  return true;
}

export function scoreCss(ctx, file, tree, added) {
  for (const r of cssRules(tree).filter((x) => overlaps(added, x.line, x.end))) {
    for (const rule of ['nesting', 'compound', 'ids', 'important']) {
      if (r[rule] > ctx.limits.css[rule]) ctx.violations.push({ rule: `css-${rule}`, file, line: r.line, value: r[rule], limit: ctx.limits.css[rule] });
    }
  }
}

// A tree lives in the parser's WebAssembly memory, which the garbage collector does not free, so each one is deleted as soon as what
// the gate needs has been taken from it. Without that a large repository fills the memory and the runtime aborts.
export async function withTree(file, text, read) {
  const parsed = await parseSource(file, text);
  try { return read(parsed); } finally { parsed?.tree?.delete(); }
}

const NO_VERSION = Object.freeze({ units: [], keys: [], totals: { cognitive: 0, lines: 0, functions: 0 }, tokens: null });
async function previousVersion(ctx, file, status, test) {
  const text = status.startsWith('A') ? null : ctx.before.get(file) ?? null;
  // A benchmark scores a skipped file too, so its old version is read as well: only what the change added is new.
  if (text === null || (ctx.mode !== 'benchmark' && skipped(file, text))) return NO_VERSION;
  const lines = text.split('\n');
  return withTree(file, text, (parsed) => {
    if (!parsed?.tree) return NO_VERSION;
    const units = unitsOf(parsed.tree, { file, isTest: test });
    return { units, keys: units.map((u) => keyOf(lines, u)), totals: totalsOf(parsed.tree, units), tokens: familyOf(parsed.language) && !test ? tokensOf(parsed.tree) : null };
  });
}

// A deleted file scores nothing, but what it held may have moved to another file the change touched.
async function recordDeleted(ctx, file, status) {
  if (familyOf(languageOf(file)) === 'js') ctx.coupling.deleted.push(file);
  ctx.moves.before.push(...(await previousVersion(ctx, file, status, isTest(file))).keys);
}

async function scoreCode(ctx, { file, status, added, hunks, lines, tree, language, errors }) {
  const test = isTest(file);
  const units = unitsOf(tree, { file, isTest: test });
  const old = await previousVersion(ctx, file, status, test);
  // A function the parser could not follow is not scored, and with any such function the file's total is not trusted either.
  const readable = (u) => !errors.some(([a, b]) => a <= u.end && b >= u.start);
  for (const pair of pairUnits(old.units, units, (line) => oldLine(hunks, line))) if (touches(pair.after, added) && readable(pair.after)) scoreUnit(ctx, { file, lines, ...pair });
  const keyed = units.map((u) => ({ key: keyOf(lines, u), cognitive: u.cognitive, lines: u.lines }));
  ctx.moves.before.push(...old.keys);
  ctx.moves.after.push(...keyed.map((u) => u.key));
  if (errors.length === 0) ctx.totals.push({ file, now: totalsOf(tree, units), was: old.totals, units: keyed, own: new Set(old.keys) });
  // Copies are looked for in product code. Copied setup between tests is mostly benign (Kapser and Godfrey), and it was most of the
  // false alarms on known-good projects.
  if (language === 'python') scorePython(ctx, { file, tree, added, test }); else scoreSlop(ctx, { file, tree, added, language, test });
  const family = familyOf(language);
  if (family === 'js') ctx.coupling.touched.push(file);
  if (family === 'js' && !test) ctx.coupling.exports.push({ file, names: exportsAdded(tree, added) });
  if (!family || test) return;
  const size = ctx.limits.clones.tokens;
  ctx.cloneAfter.push({ file, family, tokens: tokensOf(tree), size });
  if (old.tokens) ctx.cloneBefore.push({ file, family, tokens: old.tokens, size });
}

async function scoreFile(ctx, file, { status, added, hunks }) {
  if (!languageOf(file)) { if (!status.startsWith('D') && UNCOVERED.test(file)) ctx.uncovered.push(file); return; }
  if (status.startsWith('D')) return recordDeleted(ctx, file, status);
  const text = ctx.after.get(file) ?? null;
  if (text === null || skipFile(ctx, file, text)) return;
  const lines = text.split('\n');
  const parsed = await parseSource(file, text);
  let commented = false;
  const mark = ctx.violations.length;
  try {
    if (parsed?.tree) scoreComments(ctx, file, parsed.tree, added); else scoreLines(ctx, file, lines, added);
    commented = true;
    await scoreParsed(ctx, { file, status, added, hunks, lines, parsed });
  } catch (e) {
    // Code nested deeper than the measuring walks can follow is unanalyzed, as a parse that never finished is, rather than the gate
    // failing to run at all. Its added lines are still checked for suppressions, line by line, as when there is no tree.
    if (!(e instanceof RangeError)) throw e;
    if (!commented) { ctx.violations.length = mark; scoreLines(ctx, file, lines, added); }
    ctx.unanalyzed.push({ file, reason: TOO_DEEP });
    report(ctx, { rule: 'unanalyzed', file, line: 1, value: 1, limit: 0, reason: TOO_DEEP });
  } finally { parsed?.tree?.delete(); }
}

async function scoreParsed(ctx, { file, status, added, hunks, lines, parsed }) {
  // A change the parser cannot follow cannot be measured, so it must not pass as clean. An error elsewhere in the file only stops the
  // functions it sits in from being scored. In a project this is a warning: a grammar can lag valid new syntax, and failing correct
  // code on that would teach people to ignore the gate. In a benchmark it fails, so an agent cannot pass by writing what the gate
  // cannot read.
  const unreadable = parsed?.unanalyzed ?? (parsed.errors.some(([a, b]) => overlaps(added, a, b)) ? 'the parser could not follow the changed lines' : null);
  if (unreadable) {
    ctx.unanalyzed.push({ file, reason: unreadable });
    report(ctx, { rule: 'unanalyzed', file, line: 1, value: 1, limit: 0, reason: unreadable });
    return;
  }
  ctx.scored.files += 1;
  if (parsed.language === 'css') scoreCss(ctx, file, parsed.tree, added);
  else await scoreCode(ctx, { file, status, added, hunks, lines, ...parsed });
}

async function cachedTokens(cache, file, text) {
  const key = cache ? `${file}\0${crypto.createHash('sha1').update(text).digest('hex')}` : null;
  if (key && cache.has(key)) return cache.get(key);
  // A file nested too deeply to walk is left out of the comparison, as one the parser could not read is.
  const tokens = await withTree(file, text, (parsed) => { try { return parsed?.tree ? tokensOf(parsed.tree) : null; } catch (e) { if (e instanceof RangeError) return null; throw e; } });
  if (key) cache.set(key, tokens);
  return tokens;
}

// Every scored file of the families the change touched, as it is after the change: the import graph reads them, and the copy
// comparison the product files among them. The files the change touched come first and are always read. Past the cap the rest is not
// read, and the report says so, since an import from a file beyond it is not seen.
function repoTexts(ctx, touched) {
  const families = new Set([...ctx.cloneAfter.map((f) => f.family), ...(ctx.coupling.touched.length ? ['js'] : [])]);
  const wanted = ctx.repoFiles.filter((f) => families.has(familyOf(languageOf(f))) && !SKIPPED.test(f) && !MINIFIED.test(f));
  const ordered = [...wanted.filter((f) => touched.has(f)), ...wanted.filter((f) => !touched.has(f))];
  if (ordered.length > ctx.maxGraphFiles) ctx.warnings.push({ rule: 'coupling-scope', file: '.', line: 1, value: ordered.length, limit: ctx.maxGraphFiles });
  return new Map([...filesAt(ctx.root, ctx.to, ordered.slice(0, ctx.maxGraphFiles))].filter(([file, text]) => !skipped(file, text)));
}

// The rest of the repository is what a copy is compared against. Test files are left out of it: copied setup in tests is often benign.
// A caller scoring many changes in one repository can pass a cache, so files it has read once are not parsed again. Past the cap the
// rest is not read, and the report says so, since a copy of a file beyond it would be missed.
async function restOfRepo(ctx, touched, texts) {
  const rest = [];
  const families = new Set(ctx.cloneAfter.map((f) => f.family));
  const candidates = [...texts.keys()].filter((f) => families.has(familyOf(languageOf(f))) && !touched.has(f) && !isTest(f));
  if (candidates.length > ctx.maxRepoFiles) ctx.warnings.push({ rule: 'clone-scope', file: '.', line: 1, value: candidates.length, limit: ctx.maxRepoFiles });
  for (const file of candidates.slice(0, ctx.maxRepoFiles)) {
    const text = texts.get(file);
    const tokens = await cachedTokens(ctx.cache, file, text);
    if (tokens) rest.push({ file, family: familyOf(languageOf(file)), tokens, size: ctx.limits.clones.tokens });
  }
  return rest;
}

// The import aliases of the repository's root tsconfig.json, or jsconfig.json when it has none, as they are after the change.
const CONFIGS = ['tsconfig.json', 'jsconfig.json'];
function aliasesAt(ctx) {
  const config = CONFIGS.find((f) => ctx.repoFiles.includes(f));
  return config ? aliasesFrom(filesAt(ctx.root, ctx.to, [config]).get(config) ?? '') : [];
}

/**
 * The gate's verdict on the change from `from` to `to`: { ok, violations, warnings, exemptions, scored, unanalyzed, skipped, uncovered }.
 * Each violation is { rule, file, line, name?, value, limit, before? }.
 */
export async function qualityGate(root, { from, to, limits, now = new Date().toISOString(), mode = 'project', repoFiles = [], cache = null, maxRepoFiles = MAX_REPO_FILES, maxGraphFiles = MAX_GRAPH_FILES, forbid = [] }) {
  const ctx = { root, from, to, limits, now, mode, repoFiles, cache, maxRepoFiles, maxGraphFiles, forbid, isTest, coupling: { touched: [], deleted: [], exports: [], renames: new Map() }, violations: [], warnings: [], exemptions: [], unanalyzed: [], skipped: [], uncovered: [], scored: { files: 0, functions: 0 }, cloneAfter: [], cloneBefore: [], totals: [], moves: { before: [], after: [] }, pyExports: [] };
  const changed = addedRanges(root, from, to);
  // The changed code is read up front, a batch at a time. One git process per file was most of the gate's time on a large branch.
  const code = [...changed].filter(([file]) => languageOf(file));
  ctx.before = filesAt(root, from, code.filter(([, c]) => !c.status.startsWith('A')).map(([file]) => file));
  ctx.after = filesAt(root, to, code.filter(([, c]) => !c.status.startsWith('D')).map(([file]) => file));
  for (const [file, change] of changed) await scoreFile(ctx, file, change);
  scoreTotals(ctx);
  await scoreUnusedExports(ctx, { skipped: SKIPPED, maxFiles: ctx.maxRepoFiles });
  // The rest of the repository is only read when the change holds code it is compared with.
  const touched = new Set(changed.keys());
  const texts = ctx.cloneAfter.length > 0 || ctx.coupling.touched.length > 0 ? repoTexts(ctx, touched) : new Map();
  if (ctx.coupling.touched.length > 0) scoreCoupling(ctx, texts, renamedFiles(root, from, to), aliasesAt(ctx));
  const rest = ctx.cloneAfter.length > 0 ? await restOfRepo(ctx, touched, texts) : [];
  for (const family of new Set(ctx.cloneAfter.map((f) => f.family))) {
    const of = (files) => files.filter((f) => f.family === family);
    for (const c of findClones({ after: of(ctx.cloneAfter), before: of(ctx.cloneBefore), rest: of(rest) })) ctx.violations.push({ rule: 'clone', file: c.file, line: c.line, value: c.lines, limit: 0, other: c.other, similarity: c.similarity });
  }
  const { violations, warnings, exemptions, scored, unanalyzed, skipped: notScored, uncovered } = ctx;
  return { ok: violations.length === 0, violations, warnings, exemptions, scored, unanalyzed, skipped: notScored, uncovered };
}
