// escalation-facts.mjs — diffFacts(rows, options): the facts escalation() reads, from the per-file rows of a diff.
//
// A row is { file, added, deleted, status }: the changed-file listing's shape plus git's status letter. The listing must be
// read NUL-separated (`-z`): git's default form quotes a non-ASCII name (`"\303\251/a.pem"`), which the deny list cannot
// read, so a name that starts with a double quote is an unusable row here (a name that really starts with one over-flags), and so is a name with a control, format or line-separator character (`.e<ZWNJ>nv` is `.env` on HFS+).
// Pure but for a clock: no filesystem, no git, no content, and no path in the result. Returns
//   { facts, source, notes }
//   facts   escalation()'s input: counts, flags and class names from its closed lists
//   source  where each plan input came from: { plan: ['target'|'paths'], sdlc: ['slug'|'paths'] }, as ids
//   notes   ids of what degraded: rows_unusable (not a list, over MAX_ROWS, or a count past the safe integers), row_unusable, time_box, config_refused,
//           internal_error (a bug here: the result is the floor, never a throw)
// options: { config, slug, target, planPaths, workItemPaths, budgetMs }. `config` is loadConfig's `{global, project}` result or
// nothing: any other shape (a merged `.config` erases the user's own additions) is noted `config_refused` and the built-in lists apply.
// A key of it that classifyPaths refuses is noted too, and adds the sensitive name `config`: a refused list must raise, never lower.
// `target` is the review target a caller names (a plan directory, a brief or an ADR path), judged by its name only. `planPaths`
// and `workItemPaths` are names-only lists the caller built; only whether they are empty matters. `budgetMs` can only shorten
// TIME_BOX_MS.
//
// Every degraded outcome (an unusable row too: it may hide anything) is the FLOOR, the top of the lattice: every count at the cap, every
// class name, every flag, so each seat, reason, hard-surface id and flag is at least a full read's. A time box cannot interrupt
// synchronous code, so the clock is read between chunks of CHUNK rows: the bound is the budget plus one chunk, which is small
// because classifyPaths caps the cost of one path. A denied name sets `denied` whatever its status or prefix: a deleted `.env`
// floors, and so does one under `.somi/`. Rows under `.somi/` and `.claude/` are ignored (the measurement excludes them), by their
// exact prefix, and every row, ignored or not, is read for the guard: on its segments folded as the deny list folds them (case,
// compatibility forms, trailing dots and spaces, either separator) a first segment `.claude`, at any depth and with no exemption, or
// `.somi` alone or followed by `config.json` is the sensitive name `config`. A row that is not a plain name (an empty, `.` or `..`
// segment, git never writes one) is unusable.
// `new_top_dirs` counts first directories whose every changed row is an add; a diff cannot know the base, so a directory that
// existed and only gained files reads as new, and the residual is one extra architecture seat.
import { classifyPaths } from './path-facts.mjs';
import { MAX_PATH_CHARS, UNSAFE_CHARS, denyListed, foldName, trimDots } from './path-safety.mjs';
import { CLASS_NAMES } from './escalation.mjs';

export const MAX_ROWS = 2000;
export const TIME_BOX_MS = 3000;
const CHUNK = 10; // rows per clock read: well under classifyPaths' list cap, and about 0.6 s at its worst-case cost per path
const KINDS = ['sensitive', 'boundary', 'contract'];
const COUNTS = ['production_lines', 'production_files', 'test_lines_added', 'test_lines_deleted', 'test_files_deleted', 'test_files_changed', 'modules', 'new_top_dirs'];

const count = (v) => Number.isSafeInteger(v) && v >= 0;
const SEP = /[\\/]/;
// A name's segments as the deny list reads them: each raw segment folded and re-split (a fold can make a separator), dots and spaces trimmed off the end.
const pieces = (file) => file.split(SEP).flatMap((s) => foldName(s).split(SEP)).map(trimDots);
const sane = (r) => r !== null && typeof r === 'object' && typeof r.file === 'string' && r.file.length > 0 && r.file.length <= MAX_PATH_CHARS && foldName(r.file).length <= MAX_PATH_CHARS
  && !r.file.startsWith('"') && !UNSAFE_CHARS.test(r.file) && !pieces(r.file).includes('') && count(r.added) && count(r.deleted) && typeof r.status === 'string' && /^[A-Z]$/.test(r.status);
const hidden = (file) => ['.somi', '.claude'].includes(file.split('/')[0]);
const guarded = (file) => { const [head, second] = pieces(file); return head === '.claude' || (head === '.somi' && (second === undefined || second === 'config.json')); };
const loaded = (c) => c === undefined || ['global', 'project'].every((k) => { const l = Object.hasOwn(Object(c), k) ? c[k] : undefined; const cfg = l !== null && typeof l === 'object' && Object.hasOwn(l, 'config') ? l.config : undefined; return cfg !== null && typeof cfg === 'object' && !Array.isArray(cfg); });
const given = (v) => v !== undefined && v !== null && v !== false && v !== '' && !(Array.isArray(v) && v.length === 0);
const PLAN_TARGET = /(^|\/)(\.somi\/plans|adrs?|decisions)(\/|$)|(^|\/)(brief\.md|adr[-_]?\d[^/]*)$/;
const names = (set) => [...set].sort();

// An unusable `target` (not a string, or over the length cap) counts as a plan target: a bad input raises a seat, never removes one.
function planInputs({ slug, target, planPaths, workItemPaths }) {
  const named = given(target) && (typeof target !== 'string' || target.length > MAX_PATH_CHARS || PLAN_TARGET.test(target.normalize('NFKC').toLowerCase().replaceAll('\\', '/')));
  const facts = { plan_target: named, plan_paths: given(planPaths), slug_given: given(slug), work_item_paths: given(workItemPaths) };
  const source = { plan: [...(named ? ['target'] : []), ...(facts.plan_paths ? ['paths'] : [])], sdlc: [...(facts.slug_given ? ['slug'] : []), ...(facts.work_item_paths ? ['paths'] : [])] };
  return { facts, source };
}

const EVERY_PLAN_SEAT = { facts: { plan_target: true, plan_paths: true, slug_given: true, work_item_paths: true }, source: { plan: ['target', 'paths'], sdlc: ['slug', 'paths'] } };

// No test lines added and no test file changed keep `tests_weakened` and `untested_production` on: they are the two facts a count cannot raise.
const floor = (plan) => ({ ...Object.fromEntries(COUNTS.map((k) => [k, 1e9])), test_lines_added: 0, test_files_changed: 0, denied: true, ...plan,
  classes: Object.fromEntries(Object.entries(CLASS_NAMES).map(([k, v]) => [k, [...v]])) });

function measure(rows, opts, plan) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) return { facts: floor(plan), notes: ['rows_unusable'] };
  if (!rows.every(sane)) return { facts: floor(plan), notes: ['row_unusable'] };
  const f = { ...Object.fromEntries(COUNTS.map((k) => [k, 0])), denied: false, ...plan };
  const seen = { sensitive: new Set(), boundary: new Set(), contract: new Set() };
  const modules = new Set(); const tops = new Map(); const kept = []; const notes = new Set();
  const config = loaded(opts.config) ? opts.config : undefined;
  if (config !== opts.config) notes.add('config_refused');
  const refused = classifyPaths([], config).refused; // no row may be needed to learn that a key was refused
  if (refused.length > 0) notes.add('config_refused');
  if (refused.includes('sensitive_paths')) seen.sensitive.add('config');
  for (const r of rows) {
    if (guarded(r.file)) seen.sensitive.add('config');
    if (!hidden(r.file)) kept.push(r); else f.denied ||= denyListed(r.file);
  }
  const start = Date.now(); const budget = Math.min(TIME_BOX_MS, Number.isFinite(opts.budgetMs) && opts.budgetMs >= 0 ? opts.budgetMs : TIME_BOX_MS);
  for (let at = 0; at < kept.length; at += CHUNK) {
    if (Date.now() - start >= budget) return { facts: floor(plan), notes: ['time_box'] };
    const chunk = kept.slice(at, at + CHUNK);
    const result = classifyPaths(chunk.map((r) => r.file), config);
    result.files.forEach((c, j) => {
      const r = chunk[j];
      f.denied ||= c.denied;
      for (const k of KINDS) c[k].forEach((n) => seen[k].add(n));
      modules.add(c.module);
      if (c.production) { f.production_lines += r.added + r.deleted; f.production_files++; } else {
        f.test_lines_added += r.added; f.test_lines_deleted += r.deleted; f.test_files_changed++;
        if (r.status === 'D') f.test_files_deleted++;
      }
      const dirs = r.file.split(/[\\/]+/).filter((x) => x !== '' && x !== '.');
      if (dirs.length > 1) tops.set(dirs[0], (tops.get(dirs[0]) ?? true) && r.status === 'A');
    });
  }
  f.modules = modules.size; f.new_top_dirs = [...tops.values()].filter(Boolean).length;
  if (!COUNTS.every((k) => count(f[k]))) return { facts: floor(plan), notes: ['rows_unusable'] }; // a sum past the safe integers is no count
  // CI paths are a sensitive name (they raise security); `classes.ci` carries the hard-surface id beside it.
  f.classes = { sensitive: names(seen.sensitive), boundary: names(seen.boundary), contract: names(seen.contract), ci: seen.sensitive.has('ci') ? ['ci'] : [] };
  return { facts: f, notes: names(notes) };
}

export function diffFacts(rows, options) {
  let plan = EVERY_PLAN_SEAT; // until the options are read
  try {
    const opts = options ?? {};
    plan = planInputs(opts);
    return { ...measure(rows, opts, plan.facts), source: plan.source };
  } catch {
    return { facts: floor(plan.facts), source: plan.source, notes: ['internal_error'] };
  }
}
