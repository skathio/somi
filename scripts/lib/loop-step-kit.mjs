// loop-step-kit.mjs -- what the composite steps share: the response budget and its shaping (base, finalize, fitLines), the
// per-step cursor (begin, advance: one sub-step and its mark saved together), the replay of a finished step, the usable-state
// check (stateAt) and the findings read by the response. loop-step.mjs, loop-step-review.mjs and loop-step-close.mjs import it; it imports none of them.

import fs from 'node:fs';
import path from 'node:path';
import { KINDS, usageError } from './loop-exit.mjs';
import { documentedStatus, entryOk } from './loop-engine.mjs';
import { loadState, nowIso, saveState } from './loop-state.mjs';
import { OBJECT_ID, REVIEW_SCOPES } from './loop-review.mjs';
import { CONTROL, plainDir, readPlanFile } from './loop-notes.mjs';
import { atOrAbove, ledgerPaths, SEVERITIES } from './findings-ledger.mjs';

export const BUDGET = 2500;

export const MODES = Object.freeze(['single', 'security', 'panel']); // weakest first: an argument may only move right
export const ARG = Object.freeze({ max_passes: 'max_passes', diff_cap_lines: 'diff_cap' }); // the argument that sets each cap
const STORED = ['ok', 'step', 'pass', 'next', 'stop_reason', 'exit', 'wrote', 'unwritten', 'loop', 'caps', 'review_min', 'brief', 'truncated', 'verdict', 'verdict_pass', 'findings', 'findings_total', 'recurring_cross_run', 'resolved', 'skipped', 'close_args', 'open_findings', 'open_findings_note', 'status', 'blockers', 'majors', 'diff', 'dispatches', 'cap_overrides', 'reviews']; // every field of a stored (open, plan after-code, after-review, close) response

export class Killed extends Error {} // the tests' simulated kill: the one error runStep lets through
export const freezeFields = (t) => Object.freeze(Object.fromEntries(Object.entries(t).map(([step, list]) => [step, Object.freeze(list)]))); // a step's argument table: no caller can widen what a step accepts
export const bad = (field, why) => usageError(`${field}: ${why}`);
export const clean = (s, n) => String(s).replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(CONTROL, '').replace(/\s+/g, ' ').trim().slice(0, n);
export const size = (r) => Buffer.byteLength(JSON.stringify(r));
export const cut = (s, n) => { let t = clean(s, n).replace(/`/g, ''); while (size(t) - 2 > n) t = t.slice(0, -1); return t; }; // n counts bytes of JSON, not characters; no backtick, so a name cannot close the fence it sits in
export const base = (step, over) => ({ ok: true, step, pass: null, next: null, stop_reason: null, exit: 0, wrote: [], unwritten: [], replayed: false, ...over });

// A finished step answers from its stored response. A tool cap argument that would still tighten a cap is refused with
// 64, not dropped: the caller asked for a change this repeat cannot make, and says so on its next step.
export function replayOf(state, key, overrides) {
  const done = state.steps?.[key]?.response;
  const late = done && overrides.find((o) => o.source === 'tool');
  if (late) throw bad(ARG[late.field], `${late.to} is below the cap in force (${late.from}) but this step already finished; pass it with the next step`);
  return done ? { ...Object.fromEntries(Object.entries(done).filter(([k]) => STORED.includes(k))), replayed: true } : null; // an allow-list: a field this build never stores is not passed on
}

// The caps as the response shows them (an allow-list: nothing else stored reaches it) and the severity floor in force.
export function capsView(state) {
  const floor = typeof state.caps.severity_floor === 'string' && SEVERITIES.includes(state.caps.severity_floor) ? state.caps.severity_floor : 'Major'; // a stored floor that is not one of the four names (an array of one included) is shown, and judged, as Major
  return { floor, caps: { ...Object.fromEntries(['max_passes', 'diff_cap_lines'].filter((k) => k in state.caps).map((k) => [k, state.caps[k]])), severity_floor: floor } };
}

// A notes writer's result into a step's stored `out`: the paths written (each once), the refusals as pointers within the response budget.
export function keep(out, r) {
  for (const w of r.wrote) if (!out.wrote.includes(w)) out.wrote.push(w);
  out.unwritten.push(...r.unwritten.map((u) => ({ ...u, line: cut(u.line, 120) })));
}

// The step's cursor, created on first use with the time stored once; `advance` runs one sub-step and saves it with its mark.
export function begin(ctx, state, key) {
  state.steps ??= {};
  return (state.steps[key] ??= { via: ctx.via === 'mcp' ? 'mcp' : 'cli', at: (ctx.now ?? nowIso)(), done: [] });
}
export function advance(ctx, sf, state, entry, name, work) {
  if (entry.done.includes(name)) return;
  work();
  entry.done.push(name);
  saveState(sf, state);
  if (ctx.failAfter === name) throw new Killed(`failAfter ${name}`);
}
// The response within BUDGET: the lists lose their tail first (the totals say so), then the review brief; past that only the outcome stays.
const SHED = [
  (x) => { const o = x.diff?.out_of_scope; if (!o?.length) return false; x.diff.out_of_scope_total ??= o.length; o.pop(); return true; },
  (x) => x.scope?.files?.length > 0 && (x.scope.files.pop(), true),
  (x) => 'review_brief' in x && delete x.review_brief,
];
function within(resp) {
  const x = structuredClone(resp);
  while (size(x) > BUDGET) if (!SHED.some((f) => f(x))) return base(x.step, { ok: x.ok, pass: x.pass, next: x.next, stop_reason: x.stop_reason, exit: x.exit, truncated: true });
  return x;
}
export const finalize = (sf, state, entry, resp) => { entry.response = within(resp); saveState(sf, state); return entry.response; }; // an over-budget response is never stored

const rank = (s) => (SEVERITIES.includes(s) ? SEVERITIES.indexOf(s) : SEVERITIES.length); // an unrated one sorts last
// Open findings at or above the floor as `F-id: title`, read with the notes writers' confinement; no ledger yet is no
// findings (a read never seeds one), a ledger that is linked, special, oversized or malformed is flagged, never followed.
export function floorLines(root, slug, floor, run) { // `run`: only findings sighted in that loop run
  const { file } = ledgerPaths(root, slug);
  const dir = plainDir(root, path.relative(root, path.dirname(file)).split(path.sep));
  const led = dir.dir ? readPlanFile(file) : dir;
  if (led.reason === 'missing') return [];
  try {
    if (!led.text) throw new Error(led.reason);
    // no cut here: fitLines fits what the budget holds and counts the rest
    return JSON.parse(led.text).findings.filter((f) => f?.status === 'open' && /^F-\d+$/.test(f.id) && atOrAbove(f.severity, floor) && (!run || f.seen.some((s) => s?.run === run)))
      .sort((x, y) => rank(x.severity) - rank(y.severity) || Number(x.id.slice(2)) - Number(y.id.slice(2)))
      .map((f) => `${f.id}: ${clean(f.title, 100).replace(/`/g, '').replace(/^[#>\s-]+/, '')}`);
  } catch { return ['(the findings ledger is unreadable)']; }
}

// build(kept) -> response for the longest prefix of `lines` that fits the budget; what is cut is counted, not hidden.
export function fitLines(build, lines) {
  const make = (k) => build([...lines.slice(0, k), ...(k < lines.length ? [`(+${lines.length - k} more: see the findings ledger)`] : [])]);
  let k = 0;
  while (k < lines.length && size(make(k + 1)) <= BUDGET) k++;
  return make(k);
}

// A running state is usable only if everything open reads has its type and bound; anything else reads as unreadable.
const intCap = (v) => Number.isInteger(v) && v >= 0;
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const SUB_STEPS = Object.freeze(['pass', 'dispatch', 'record', 'findings', 'resolve', 'finish', 'diary', 'row', 'activity']); // every sub-step any step records, in the order the steps run them: a cursor naming another is unreadable
const short = (v, n) => typeof v === 'string' && v.length <= n;
// An absent kind is sound: a response stored before items carried one is replayed as it was.
const outSound = (o) => plain(o) && Array.isArray(o.wrote) && o.wrote.length <= 6 && o.wrote.every((w) => short(w, 200)) // room for the closing step: a diary and its archive, the progress.md row and its Last activity line
  && Array.isArray(o.unwritten) && o.unwritten.length <= 6 && o.unwritten.every((u) => plain(u) && short(u.file, 100) && short(u.reason, 100) && short(u.line, 300) && (u.kind === undefined || KINDS.includes(u.kind)) && (u.code === undefined || short(u.code, 32)));
const foundSound = (f) => plain(f) && Array.isArray(f.lines) && f.lines.length <= 12 && f.lines.every((l) => /^F-\d{1,9} (new|known)( recurring)?( cross-run)?$/.test(l)) && Number.isInteger(f.total) && Array.isArray(f.cross) && f.cross.length <= 10 && f.cross.every((c) => /^F-\d{1,9}$/.test(c)) && typeof f.breaker === 'boolean';
const fixedSound = (f) => plain(f) && ['resolved', 'skipped'].every((k) => Array.isArray(f[k]) && f[k].length <= 100 && f[k].every((x) => /^F-\d{1,9}( Blocker| Major| Minor| Nit| Unrated)?$/.test(x)));
const diffSound = (d) => plain(d) && [d.lines, d.weighted].every((n) => Number.isInteger(n) && n >= 0) && Array.isArray(d.out_of_scope) && d.out_of_scope.length <= 6 && d.out_of_scope.every((f) => short(f, 62));
const openSound = (o) => plain(o) && Array.isArray(o.ids) && o.ids.length <= 12 && o.ids.every((i) => /^F-\d{1,9}$/.test(i)) && Number.isInteger(o.total) && o.total >= o.ids.length;
const sound = (e) => plain(e) && Array.isArray(e.done) && e.done.every((d) => SUB_STEPS.includes(d)) && typeof e.at === 'string'
  && (e.review === undefined || (plain(e.review) && MODES.includes(e.review.mode) && REVIEW_SCOPES.includes(e.review.scope)))
  && (e.sig === undefined || (typeof e.sig === 'string' && /^[0-9a-f]{16}$/.test(e.sig))) && (e.found === undefined || foundSound(e.found)) && (e.fixed === undefined || fixedSound(e.fixed))
  && (e.status === undefined || documentedStatus(e.status)) && (e.diff === undefined || diffSound(e.diff))
  && (e.open === undefined || openSound(e.open)) && (e.measured === undefined || (typeof e.measured === 'string' && OBJECT_ID.test(e.measured)))
  && (e.response === undefined || (plain(e.response) && size(e.response) <= BUDGET)) && (e.out === undefined || outSound(e.out));
function usable(s) {
  return s?.status === 'running' && ['code', 'plan'].includes(s.loop) && Number.isInteger(s.pass) && s.pass >= 0 && plain(s.caps)
    && typeof s.baseline_sha === 'string' && OBJECT_ID.test(s.baseline_sha) && Array.isArray(s.history) && s.history.every((h) => plain(h) && entryOk(h) && (h.tree === undefined || (typeof h.tree === 'string' && OBJECT_ID.test(h.tree)))) // these two reach git
    && intCap(s.caps.max_passes) && (s.loop === 'plan' ? s.caps.diff_cap_lines === undefined || intCap(s.caps.diff_cap_lines) : intCap(s.caps.diff_cap_lines) && Array.isArray(s.iteration_files) && s.iteration_files.every((f) => typeof f === 'string'))
    && (s.review_min === undefined || s.review_min === 'security') && (s.dispatches === undefined || Array.isArray(s.dispatches)) && (s.steps === undefined || (plain(s.steps) && Object.values(s.steps).every(sound)));
}

// -> the usable state at `sf`; undefined when nothing is there; null for anything else at the path (a dangling link,
// unreadable, a broken shape, a loop that is over). `finished` admits a loop that is over, for the read-only step.
export function stateAt(sf, finished = false) {
  let st; try { st = fs.lstatSync(sf); } catch (e) { return e.code === 'ENOENT' ? undefined : null; }
  let state = null; try { state = st.isFile() ? loadState(sf) : null; } catch { state = null; }
  return usable(finished && plain(state) ? { ...state, status: 'running' } : state) ? state : null;
}
export const noLoop = (a) => usageError(`no running loop state for ${a.slug}${a.iteration ? ` ${a.iteration}` : ''}: call open first`);

// The sink for an internal error's one JSON line (runStep's `log`): <state dir>/step-errors.log, never the stderr a model reads.
// Written only through real directories (the default state directory is walked from the project root without following a
// link; one the operator named is trusted), never through a link or into a special file, and capped: a line that would pass
// LOG_MAX moves the log to step-errors.log.1 (replacing whatever was there, a link included, which is not followed) first. A failure is swallowed by runStep.
export const LOG_MAX = 65536;
export function stepLog(root, stateDir, explicit) {
  const file = path.join(stateDir, 'step-errors.log');
  return (line) => {
    const text = `${line}\n`; const bytes = Buffer.byteLength(text);
    if (bytes > LOG_MAX) return;
    if (explicit) fs.mkdirSync(stateDir, { recursive: true });
    else {
      let dir = root;
      for (const part of ['.somi', 'somi-state', 'loop']) {
        dir = path.join(dir, part);
        try { if (!fs.lstatSync(dir).isDirectory()) return; } catch (e) { if (e.code !== 'ENOENT') return; fs.mkdirSync(dir); }
      }
    }
    let st = null; try { st = fs.lstatSync(file); } catch (e) { if (e.code !== 'ENOENT') return; }
    if (st && !st.isFile()) return; // a link, a FIFO or a directory is never opened
    if (st && st.size + bytes > LOG_MAX) fs.renameSync(file, `${file}.1`);
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0) | (fs.constants.O_NOCTTY ?? 0), 0o600);
    try { if (fs.fstatSync(fd).isFile()) fs.writeSync(fd, text); } finally { fs.closeSync(fd); }
  };
}
