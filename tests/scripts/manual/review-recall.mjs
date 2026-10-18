#!/usr/bin/env node
// Manual harness for the reviewer-recall pre-check: runs the plugin's review command ONCE per case on a throwaway
// repository whose working-tree change is one file of a task (the correct file for a clean case, the same file with one
// seeded defect for a mutant case) and scores the reply with tests/evals/lib/review-recall.mjs. It spends real credits
// and is NEVER run by npm test or shipped (tests/.npmignore excludes manual/).
//
//   node tests/scripts/manual/review-recall.mjs --model ALIAS [--env-file .somi/eval.env] [--seed 20261018]
//     [--budget-total 20] [--per-call 0.75] [--out DIR] [--dry-run] [--claude claude] [--sandbox auto|off]
//     [--unsafe-no-sandbox] [--plugin-dir DIR] [--ceiling medium] [--timeout-min 6] [--keep] [--note FILE] [--only m01,c02 | --pilot N]
//
// Cases: selectCases(tests/evals/ab, seed) -> 40 mutants + 10 clean, in a seeded shuffle. When the committed selection note
// (.somi/plans/micro-task-suite/phase0-log-read.md, or --note) exists, the rebuilt list must equal it or the run is refused.
// Workspace per case (the whole-task diff): the baseline commit is the task fixture ONLY (its own pre-existing tests included);
// the working tree is the complete solution, every oracle file EXCEPT those under the task's test directory (the oracle's tests
// are not shown), added with `git add -N` so `git diff` shows the whole change. A mutant case applies its one find -> replace to
// the reference solution; a clean case uses a whole unmutated solution (`oracle` or the independent `oracle2` of its task).
// One frozen mutant lives in an oracle test file: for that case alone, that one (mutated) test file is added, because the
// defect cannot exist otherwise. A diff that would be empty is a refusal. Both kinds go through the same code path; nothing in
// the prompt says that a defect is seeded or that some changes are clean.
// Invocation: the plugin's own `/somi:review` command (it Tasks the independent reviewer on a cold context), through the
// same claude command line the SoMi arm of the A/B driver uses (--plugin-dir, bypassPermissions, web tools disabled). The
// classification arm is passed as 'bare' because a review that ends in a question is not a pause here.
// Reviewer text, four sources scored separately (each cut into chunks of at most 200,000 characters, at most 1 MiB in all, so
// a long reply is not scored on its head only): the main agent's own assistant text; the tool_result that answers the main
// agent's Task/Agent call (where the reviewer's body returns); the system task_notification summary of that call; and the
// review files the command writes under .somi/reviews (copied into the case directory). Bash output and file reads are not
// sources. The row records which source produced the detecting finding and whether its cited range was wider than 10 lines.
// Canary: every oracle file carries the task's canary line; in the workspace each such line is replaced by a neutral line of
// the same line count (baseline copies and the working file alike, so the frozen line numbers hold) and the workspace is
// asserted canary-free before launch. A `leak:*` outcome halts the run, and so do two consecutive invalid rows with one reason.
// Tier: the workspace's .somi/config.json carries cost.ceiling (--ceiling) and EVERY agent of the plugin pinned to it, the
// "--pin-all" configuration of the A/B driver (a copy of its costBlock: that file runs main() on import, so it cannot be
// imported). The harness knows no model names.
// Guards: concurrency 1; --per-call is the CLI's own --max-budget-usd; the next case starts only if spent + per-call fits
// --budget-total, otherwise the run stops (exit 3) and the remaining cases are NOT recorded, so a later run with a larger
// budget continues; an account limit (a short result text, or a rejected rate-limit event; never reviewer prose) halts
// (exit 1) with the reset text and records that case as not scored; a call that costs more than 1.5 x --per-call halts.
// Resume: --out may hold a results.jsonl; every row carries the model alias, ceiling, seed, plugin hash and selection hash
// and a resume with any difference is refused; cases whose last row is `scored` are skipped (anything else is run again).
// --pilot N runs the first N cases of the interleaved order m01,c01,m02,c02,... (default shape of a cheap first look). The token is read once, handed to the child and the stream sink only, and is in no row, log
// line or kept file. Everything is written under --out and a per-case temp directory (removed unless --keep).

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPlugin, childEnv, classify, claudeArgv, prepareWorkspace, probeSandbox, readEnvFile, resolveBinary, runClaude, sandboxArgs, sandboxSpec, seededShuffle, taskText } from '../../evals/lib/ab-draw.mjs';
import { createSink, redactToken, sweepProcesses } from '../../evals/lib/ab-stream.mjs';
import { DEFAULT_SEED, DETECTING, MAX_FINDINGS, MAX_INPUT_CHARS, mutatedRange, overlaps, parseFindings, recallStats, sameFile, scoreClean, scoreMutant, selectCases } from '../../evals/lib/review-recall.mjs';
import { VALID_COSTS } from '../../../scripts/lib/cost-model.mjs';
import { validateCostConfig } from '../../../scripts/lib/cost-config.mjs';

const REPO = path.resolve(import.meta.dirname, '../../..');
const AB = path.join(REPO, 'tests/evals/ab');
const DEFAULT_NOTE = path.join(REPO, '.somi/plans/micro-task-suite/phase0-log-read.md');
const FLAGS = new Set(['model', 'env-file', 'seed', 'budget-total', 'per-call', 'out', 'claude', 'sandbox', 'plugin-dir', 'ceiling', 'timeout-min', 'note', 'only', 'pilot']);
const SWITCHES = new Set(['dry-run', 'unsafe-no-sandbox', 'keep']);
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,63}$/;
const MAX_STREAM = 16 * 1024 * 1024;
const TMP_PREFIX = 'wk-';
const SOURCES = ['taskResult', 'notification', 'reviewFile', 'assistant'];
const MAX_REVIEW_FILES = 20;
const MAX_REVIEW_FILE = 256 * 1024;
const WIDE_LINES = 10;
const COST_HALT_FACTOR = 1.5;
const LIMIT_RESULT = /hit your (session|weekly|usage|five.hour) limit|usage limit|resets \d/i;
const RESET_TEXT = /resets [^\n"\u00b7]{1,60}/i;
const MAX_KEPT_TEXT = 1024 * 1024;
const KEPT_FINDINGS = 20;
const GIT_MS = 20000;
const kills = new Set();
const killAll = () => { for (const k of [...kills]) k(); };
const die = (msg, code = 2) => { killAll(); process.stderr.write(`review-recall: ${msg}\n`); process.exit(code); };
const liveTmp = new Set();
process.on('exit', () => { killAll(); for (const d of liveTmp) fs.rmSync(d, { recursive: true, force: true }); });

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || (!FLAGS.has(k) && !SWITCHES.has(k))) die(`unknown argument ${JSON.stringify(argv[i].slice(0, 40))}`);
    if (SWITCHES.has(k)) a[k] = true;
    else if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) die(`--${k} needs a value`);
    else a[k] = argv[++i];
  }
  const num = (k, d, min) => { const v = a[k] === undefined ? d : Number(a[k]); if (!Number.isFinite(v) || v < min) die(`--${k} must be a number >= ${min}`); return v; };
  if (a.sandbox !== undefined && !['auto', 'off'].includes(a.sandbox)) die('--sandbox must be auto or off');
  if (a.ceiling !== undefined && !VALID_COSTS.includes(a.ceiling)) die(`--ceiling must be one of ${VALID_COSTS.join('|')}`);
  if (a.pilot !== undefined && (a.only !== undefined || !/^[1-9]\d{0,2}$/.test(a.pilot))) die('--pilot takes a positive number and excludes --only');
  return { ...a, seed: Math.floor(num('seed', DEFAULT_SEED, 0)), budgetTotal: num('budget-total', 20, 0.01), perCall: num('per-call', 0.75, 0.01), timeoutMin: num('timeout-min', 6, 0.001), ceiling: a.ceiling ?? 'medium' };
}

/** The `cost` block of every workspace: the ceiling and every agent of `agentsDir` pinned to it, checked by the shared validator. */
function costBlock({ ceiling, agentsDir }) {
  const names = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
  if (names.length === 0) throw new Error(`no agents found under ${agentsDir}`);
  const cost = { ceiling, agents: Object.fromEntries(names.map((n) => [n, ceiling])) };
  validateCostConfig(cost);
  return cost;
}

// ---- the committed list -----------------------------------------------------------------------------------------

const rangeText = (m) => (m.end > m.start ? `${m.start}-${m.end}` : `${m.start}`);
/** Rows of the two tables of the selection note -> {mutants: [[task, name, file, lines]], clean: [[task, file]]}, or null if there are none. */
function readNote(file) {
  const mutants = []; const clean = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!/^\d+$/.test(cells[0] ?? '')) continue;
    if (cells.length === 5) mutants.push(cells.slice(1));
    else if (cells.length === 3) clean.push(cells.slice(1));
  }
  return mutants.length + clean.length === 0 ? null : { mutants, clean };
}
const sameRows = (a, b) => a.length === b.length && a.every((r, i) => r.length === b[i].length && r.every((c, j) => c === b[i][j]));

// ---- the workspace of one case ----------------------------------------------------------------------------------

const PATH_ONLY = (home) => ({ PATH: process.env.PATH ?? '', HOME: home });
function oracleFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile()) out.push(r);
      else throw new Error('an oracle entry is not a regular file');
    }
  };
  walk(dir, '');
  return out;
}

const neutralLine = (line) => { const t = line.trim(); return t.startsWith('<!--') ? '<!-- -->' : t.startsWith('//') ? '//' : t.startsWith('#') ? '#' : ''; };
/** Every line holding the canary becomes a neutral line, so the line count (and every frozen line number) is unchanged. */
const stripCanary = (text, canary) => text.split('\n').map((l) => (l.includes(canary) ? neutralLine(l) : l)).join('\n');
/** `rel` resolved under `base`, refusing anything that leaves it. */
function inside(base, rel) {
  const full = path.resolve(base, String(rel));
  if (typeof rel !== 'string' || rel === '' || path.isAbsolute(rel) || !full.startsWith(`${base}${path.sep}`)) throw new Error('a corpus file name leaves its directory');
  return full;
}
function filesUnder(dir, skipGit = true) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (skipGit && e.name === '.git') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) out.push(p); } };
  walk(dir);
  return out;
}

/** The throwaway repository of one case -> {ws, diff: {added, removed, files, bytes}}. Throws an Error that names the step that failed. */
function buildCase(c, tmp, cost, task) {
  const taskDir = inside(AB, c.task);
  const { ws } = prepareWorkspace({ taskDir, tmp, cost });
  const git = (...a) => { const r = spawnSync('git', a, { cwd: ws, env: { ...PATH_ONLY(tmp), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8', timeout: GIT_MS }); if (r.error || r.status !== 0) throw new Error(`git ${a[0]} failed`); return r.stdout; };
  const variant = c.kind === 'clean' ? c.variant : 'oracle';
  if (!['oracle', 'oracle2'].includes(variant)) throw new Error('unknown solution variant');
  const root = path.join(taskDir, variant);
  if (c.kind === 'mutant') inside(root, c.file);
  const testPrefix = `${task.test_dir}/`;
  let applied = false;
  for (const rel of oracleFiles(root)) {
    const mutant = c.kind === 'mutant' && rel === c.file;
    if (rel.startsWith(testPrefix) && !mutant) continue;
    let content = fs.readFileSync(path.join(root, rel), 'utf8');
    if (mutant) {
      if (mutatedRange(content, c.find, c.replace) === null) throw new Error('the mutant does not apply exactly once');
      content = content.replace(c.find, () => c.replace);
      applied = true;
    }
    const to = inside(ws, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, stripCanary(content, task.canary));
  }
  if (c.kind === 'mutant' && !applied) throw new Error('the mutated file is not part of the solution');
  git('add', '-N', '.');
  let added = 0; let removed = 0;
  for (const l of git('diff', '--numstat').trim().split('\n').filter(Boolean)) { const [a, r] = l.split('\t').map(Number); added += Number.isFinite(a) ? a : 0; removed += Number.isFinite(r) ? r : 0; }
  const names = git('diff', '--name-only').trim().split('\n').filter(Boolean);
  const diffText = git('diff');
  if (!(added + removed > 0)) throw new Error('the diff of this case is empty');
  if (c.kind === 'mutant' && !names.includes(c.file)) throw new Error('the mutated file is not in the diff');
  if (diffText.includes(task.canary) || filesUnder(ws).some((f) => fs.readFileSync(f, 'utf8').includes(task.canary))) throw new Error('the task canary is still in the workspace');
  return { ws, diff: { added, removed, files: names.length, bytes: Buffer.byteLength(diffText) } };
}

const promptFor = (task) => `/somi:review the uncommitted changes in the working tree of this repository, checked against the ticket below. Report each finding as file:line with a severity of Blocker, Major, Minor or Nit.\n\nTicket:\n${taskText(task)}`;

const ids = (ev) => (Array.isArray(ev?.message?.content) ? ev.message.content : []);
const asText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x?.type === 'text' && typeof x.text === 'string').map((x) => x.text).join('\n') : '');
/** The four text sources of a (redacted) stream file and a copied reviews directory, each bounded. */
function gather(streamFile, reviewsDir) {
  const out = { taskResult: [], notification: [], reviewFile: [], assistant: [] };
  let size = 0; try { size = fs.statSync(streamFile).size; } catch { size = MAX_STREAM + 1; }
  if (size <= MAX_STREAM) {
    const events = [];
    for (const raw of fs.readFileSync(streamFile, 'utf8').split('\n')) { if (raw === '') continue; try { events.push(JSON.parse(raw)); } catch { /* not an event */ } }
    const taskIds = new Set();
    for (const ev of events) if (ev?.type === 'assistant' && !ev.parent_tool_use_id) for (const b of ids(ev)) if (b?.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task') && typeof b.id === 'string') taskIds.add(b.id);
    for (const ev of events) {
      if (ev?.type === 'assistant' && !ev.parent_tool_use_id) for (const b of ids(ev)) if (b?.type === 'text' && typeof b.text === 'string') out.assistant.push(b.text);
      if (ev?.type === 'user' && !ev.parent_tool_use_id) for (const b of ids(ev)) if (b?.type === 'tool_result' && taskIds.has(b.tool_use_id)) out.taskResult.push(asText(b.content));
      if (ev?.type === 'system' && ev.subtype === 'task_notification' && taskIds.has(ev.tool_use_id) && typeof ev.summary === 'string') out.notification.push(ev.summary);
    }
  }
  try { for (const f of filesUnder(reviewsDir, false).sort().slice(0, MAX_REVIEW_FILES)) out.reviewFile.push(fs.readFileSync(f, 'utf8')); } catch { /* no review files */ }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n').slice(0, MAX_KEPT_TEXT)]));
}
const chunksOf = (text) => { const o = []; for (let i = 0; i < text.length; i += MAX_INPUT_CHARS) o.push(text.slice(i, i + MAX_INPUT_CHARS)); return o; };

/** Score the sources -> {hit, source, wide, unparsed, findings, total}. The rule itself is the library's (scoreMutant / scoreClean). */
function judge(c, sources) {
  let parsedAny = false; let hit = false; let source = null; let wide = false; let total = 0; const findings = [];
  for (const name of SOURCES) {
    for (const chunk of chunksOf(sources[name] ?? '')) {
      const p = parseFindings(chunk);
      if (!p.unparsed) parsedAny = true;
      total += p.findings.length; if (findings.length < KEPT_FINDINGS) findings.push(...p.findings.slice(0, KEPT_FINDINGS - findings.length));
      if (hit) continue;
      const m = { file: c.file, start: c.start, end: c.end };
      if (c.kind === 'mutant' ? scoreMutant(chunk, m).detected : scoreClean(chunk).falsePositive) {
        hit = true; source = name;
        const f = p.findings.find((x) => DETECTING.includes(x.severity) && (c.kind === 'clean' || (sameFile(x.file, m.file) && overlaps(x.lineStart, x.lineEnd, m.start, m.end))));
        wide = f ? f.lineEnd - f.lineStart + 1 > WIDE_LINES : false;
      }
    }
  }
  return { hit, source, wide, unparsed: !parsedAny, findings, total: Math.min(total, MAX_FINDINGS) };
}

/** Copy the review files the command wrote into the case directory (redacted, bounded); the originals die with the workspace. */
function keepReviews(ws, caseDir, token) {
  const from = path.join(ws, '.somi', 'reviews'); let n = 0; let bytes = 0;
  try {
    for (const f of filesUnder(from, false).sort()) {
      const st = fs.lstatSync(f);
      if (!st.isFile() || !f.endsWith('.md') || st.size > MAX_REVIEW_FILE || ++n > MAX_REVIEW_FILES || (bytes += st.size) > MAX_KEPT_TEXT) continue;
      const to = path.join(caseDir, 'reviews', path.relative(from, f));
      fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
      fs.writeFileSync(to, redactToken(fs.readFileSync(f, 'utf8'), token), { mode: 0o600 });
    }
  } catch { /* no review files */ }
}

/** The account's usage window, read from the stream's own result / rate-limit events, never from reviewer prose. */
function accountLimit(streamFile) {
  let size = 0; try { size = fs.statSync(streamFile).size; } catch { return null; }
  if (size > MAX_STREAM) return null;
  for (const raw of fs.readFileSync(streamFile, 'utf8').split('\n')) {
    if (raw === '') continue;
    let ev; try { ev = JSON.parse(raw); } catch { continue; }
    if (ev?.type === 'rate_limit_event' && /"status":"rejected"/.test(raw)) return { reset: null };
    if (ev?.type === 'result' && typeof ev.result === 'string' && ev.result.length <= 400 && LIMIT_RESULT.test(ev.result)) return { reset: RESET_TEXT.exec(ev.result)?.[0].replace(/^resets /i, '').trim() ?? null };
  }
  return null;
}

/** Remove token windows from every regular file of a kept workspace. */
function redactTree(dir, token) {
  for (const f of filesUnder(dir)) { try { const t = fs.readFileSync(f, 'utf8'); const r = redactToken(t, token); if (r !== t) fs.writeFileSync(f, r); } catch { /* unreadable */ } }
}

const sha = (...parts) => createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16);

const readRows = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
function unlock(dir) { try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory()) { fs.chmodSync(path.join(dir, e.name), 0o700); unlock(path.join(dir, e.name)); } } fs.chmodSync(dir, 0o700); } catch { /* gone */ } }
const lastRows = (rows) => { const m = new Map(); for (const r of rows) m.set(r.case, r); return m; };

function summary(rows, caseIds) {
  const total = caseIds.size;
  const mine = rows.filter((r) => caseIds.has(r.case));
  const foreign = new Set(rows.filter((r) => !caseIds.has(r.case)).map((r) => r.case)).size;
  const last = [...lastRows(mine).values()];
  const scored = last.filter((r) => r.outcome === 'scored');
  const unscored = last.filter((r) => r.outcome !== 'scored');
  const cost = rows.reduce((s, r) => s + (Number.isFinite(r.costUsd) ? r.costUsd : 0), 0);
  const st = recallStats(scored.map((r) => ({ kind: r.kind, detected: r.detected === true, falsePositive: r.falsePositive === true, unparsed: r.unparsed === true })));
  const pct = (x) => x.toFixed(3);
  const iv = (i) => (i ? `${pct(i.lower)}-${pct(i.upper)}` : 'n/a');
  const why = {}; for (const r of unscored) { const k = r.outcome === 'invalid' ? `invalid:${String(r.reason).split(':')[0]}` : r.outcome; why[k] = (why[k] ?? 0) + 1; }
  const lines = [`cases: ${scored.length} scored of ${total}, ${unscored.length} recorded but not scored, ${total - last.length} not run, ${scored.filter((r) => r.unparsed).length} unparsed`];
  lines.push(`not scored (NOT counted in R or FPR): ${unscored.length === 0 ? 'none' : Object.entries(why).map(([k, n]) => `${n} ${k}`).join(', ')}`);
  if (foreign > 0) lines.push(`${foreign} case(s) in the results file are outside this selection and were ignored`);
  if (st) {
    lines.push(`recall R = ${st.k}/${st.n} = ${pct(st.R)} (95% interval ${iv(st.interval)})`);
    lines.push(`false-positive rate FPR = ${st.f}/${st.m} = ${pct(st.FPR)} (95% interval ${iv(st.fprInterval)})`);
    lines.push(`R - FPR = ${pct(st.diff)}`);
    const det = scored.filter((r) => r.kind === 'mutant' && r.detected === true);
    const bySource = {}; for (const r of det) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    lines.push(`detections by source: ${det.length === 0 ? 'none' : Object.entries(bySource).map(([k, n]) => `${n} ${k}`).join(', ')}; ${det.filter((r) => r.wide).length} of ${det.length} from a cited range wider than ${WIDE_LINES} lines`);
    lines.push(`branch: ${st.branch}${unscored.length > 0 || scored.length < total ? ' (PROVISIONAL: not every case is scored)' : ''}${st.branch === 'UNDEFINED' ? ' (R >= 0.45 with 0.10 <= R - FPR < 0.25 is in no registered branch: the user decides)' : ''}`);
  } else lines.push('no summary: at least one scored mutant case and one scored clean case are needed');
  lines.push(`total cost: $${cost.toFixed(2)}`);
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.model !== 'string' || !MODEL.test(args.model)) die('--model <alias> is required (letters, digits and . _ : [ ] -, starting with a letter or digit)');
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN !== undefined) die('CLAUDE_CODE_OAUTH_TOKEN is already in the environment; the harness reads the env file itself');

  // Cases, in a seeded shuffle so a budget stop does not cut one kind.
  const sel = selectCases(AB, args.seed);
  const note = args.note ? path.resolve(args.note) : DEFAULT_NOTE;
  if (fs.existsSync(note)) {
    const rec = readNote(note);
    if (rec === null) die(`${note} holds no selection tables`);
    const got = { mutants: sel.mutants.map((m) => [m.task, m.name, m.file, rangeText(m)]), clean: sel.clean.map((x) => [x.task, x.variant]) };
    if (!sameRows(got.mutants, rec.mutants) || !sameRows(got.clean, rec.clean)) die(`the selection rebuilt from seed ${args.seed} differs from the committed list in ${note}; use the seed the note records`);
    console.log(`selection: equals the committed list in ${note}`);
  } else console.log(`note: ${note} does not exist, so the rebuilt selection (seed ${args.seed}) was not compared with a committed list`);
  const mutantDefs = new Map();
  for (const t of new Set(sel.mutants.map((m) => m.task))) for (const m of JSON.parse(fs.readFileSync(path.join(AB, `${t}.mutants.json`), 'utf8'))) mutantDefs.set(`${t}/${m.name}`, m);
  const pad = (n) => String(n).padStart(2, '0');
  const all = [
    ...sel.mutants.map((m, i) => ({ id: `m${pad(i + 1)}`, kind: 'mutant', task: m.task, name: m.name, file: m.file, start: m.start, end: m.end, find: mutantDefs.get(`${m.task}/${m.name}`).find, replace: mutantDefs.get(`${m.task}/${m.name}`).replace })),
    ...sel.clean.map((x, i) => ({ id: `c${pad(i + 1)}`, kind: 'clean', task: x.task, name: null, variant: x.variant, file: null })),
  ];
  let cases = seededShuffle(all, args.seed).map((c, order) => ({ ...c, order }));
  const selectionHash = sha(JSON.stringify(cases.map((c) => [c.id, c.task, c.name, c.file, c.start, c.end, c.order])));
  if (args.pilot !== undefined) {
    const order = []; for (let i = 1; i <= 40; i++) { order.push(`m${pad(i)}`); if (i <= 10) order.push(`c${pad(i)}`); }
    args.only = order.slice(0, Number(args.pilot)).join(',');
  }
  if (args.only !== undefined) {
    const want = args.only.split(',');
    if (want.some((w) => !cases.some((c) => c.id === w))) die('--only names a case id (m01..m40, c01..c10) that does not exist');
    cases = cases.filter((c) => want.includes(c.id));
  }
  const worst = cases.length * args.perCall;
  const pluginAgents = path.join(args['plugin-dir'] ? path.resolve(args['plugin-dir']) : REPO, 'agents');
  let cost;
  try { cost = costBlock({ ceiling: args.ceiling, agentsDir: pluginAgents }); } catch (e) { return die(`the cost config is not valid: ${String(e?.message ?? e).slice(0, 160)}`); }
  console.log(`cost config: ceiling ${cost.ceiling}, ${Object.keys(cost.agents).length} agents pinned to ${cost.ceiling}`);

  if (args['dry-run']) {
    let biggest = null;
    for (const c of cases) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
      try {
        const { diff } = buildCase(c, tmp, cost, JSON.parse(fs.readFileSync(path.join(inside(AB, c.task), 'task.json'), 'utf8')));
        console.log(`  ${pad(c.order)} ${c.id} ${c.kind} ${c.task} ${c.kind === 'clean' ? c.variant : `${c.file} [${c.name}] lines ${rangeText(c)}`} diff +${diff.added} -${diff.removed} over ${diff.files} file(s), ${diff.bytes} bytes`);
        if (!biggest || diff.bytes > biggest.diff.bytes) biggest = { id: c.id, diff };
      } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); die(`case ${c.id} cannot be built: ${String(e?.message ?? e).slice(0, 120)}`, 1); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    if (biggest) console.log(`largest whole-task diff: ${biggest.id}, +${biggest.diff.added} -${biggest.diff.removed} over ${biggest.diff.files} file(s), ${biggest.diff.bytes} bytes`);
    console.log(`dry run: ${cases.length} case(s) (${cases.filter((c) => c.kind === 'mutant').length} mutant, ${cases.filter((c) => c.kind === 'clean').length} clean), model ${args.model}, worst case ${cases.length} x $${args.perCall.toFixed(2)} = $${worst.toFixed(2)} against a total budget of $${args.budgetTotal.toFixed(2)}; no claude call was made`);
    return 0;
  }

  const env = readEnvFile(path.resolve(args['env-file'] ?? path.join(REPO, '.somi/eval.env')));
  if (!env.ok) die(env.reason);
  const token = env.token;
  const out = path.resolve(args.out ?? path.join(REPO, '.somi/recall-results', new Date().toISOString().replace(/[:.]/g, '-')));
  const resultsFile = path.join(out, 'results.jsonl');
  const prior = lastRows(readRows(resultsFile));
  for (const c of cases) { const r = prior.get(c.id); if (r && (r.task !== c.task || r.mutant !== c.name || r.kind !== c.kind)) die(`${resultsFile} was written for another selection (case ${c.id} differs); use a fresh --out or the same --seed`); }
  const runTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-run-'));
  process.on('exit', () => { unlock(runTmp); fs.rmSync(runTmp, { recursive: true, force: true }); });

  const claudeReal = resolveBinary(args.claude ?? 'claude') ?? (args.claude ?? 'claude');
  const sandboxMode = args.sandbox ?? 'auto';
  const realClaude = resolveBinary('claude');
  if (sandboxMode === 'off' && (args.claude === undefined || (realClaude !== null && resolveBinary(args.claude) === realClaude)) && !args['unsafe-no-sandbox']) die('--sandbox off with the real claude needs --unsafe-no-sandbox');
  let plugin;
  if (args['plugin-dir']) {
    plugin = path.resolve(args['plugin-dir']);
    if (!fs.statSync(plugin, { throwIfNoEntry: false })?.isDirectory() || fs.existsSync(path.join(plugin, 'tests/evals')) || fs.existsSync(path.join(plugin, '.somi'))) die('--plugin-dir must be a directory without tests/evals and .somi');
  } else { try { plugin = buildPlugin({ repoRoot: REPO, runTmp }); } catch (e) { die(`the plugin could not be packed: ${e.message}`, 1); } }
  const pluginHash = sha(...['agents/reviewer.md', 'commands/review.md'].map((f) => { try { return fs.readFileSync(path.join(plugin, f), 'utf8'); } catch { return ''; } }));
  const runInfo = { model: args.model, ceiling: args.ceiling, seed: args.seed, plugin: pluginHash, selection: selectionHash };
  for (const r of readRows(resultsFile)) if (JSON.stringify(r.run) !== JSON.stringify(runInfo)) die(`${resultsFile} was written by a different run (model, ceiling, seed, plugin or selection differs); use a fresh --out`);
  const spec = sandboxSpec({ home: process.env.HOME ?? os.homedir(), repoRoot: REPO, claudeReal, plugin });
  let sandboxOn = false;
  if (sandboxMode === 'auto') {
    sandboxOn = resolveBinary('bwrap') !== null && probeSandbox(spec);
    if (!sandboxOn && !args['unsafe-no-sandbox']) die('bubblewrap is not usable here; install it, or pass --unsafe-no-sandbox to accept running the agent with full host access');
  }
  // With the sandbox on, the real HOME, /tmp and this repository are hidden from the reviewer; anywhere else on the host is readable by it.
  const hidden = [process.env.HOME ?? os.homedir(), os.tmpdir(), '/tmp', REPO].map((d) => path.resolve(d));
  if (sandboxOn && !hidden.some((d) => out === d || out.startsWith(`${d}${path.sep}`))) die(`--out ${out} would be readable by the reviewer inside the sandbox; put it under HOME, /tmp or the repository`);
  console.log(sandboxOn ? 'sandbox: bubblewrap (repository, real HOME and /tmp hidden; network shared)' : 'WARNING sandbox: none, the agent runs with the maintainer privileges on this host');
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const claude = sandboxOn ? claudeReal : (args.claude ?? 'claude');

  const st = { spent: readRows(resultsFile).reduce((s, r) => s + (Number.isFinite(r.costUsd) ? r.costUsd : 0), 0), halt: null, budgetStop: false, interrupted: false, lastInvalid: null };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { st.interrupted = true; killAll(); });

  async function runCase(c) {
    const task = JSON.parse(fs.readFileSync(path.join(inside(AB, c.task), 'task.json'), 'utf8'));
    const caseDir = path.join(out, c.id);
    fs.rmSync(caseDir, { recursive: true, force: true });
    fs.mkdirSync(caseDir, { recursive: true, mode: 0o700 });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
    liveTmp.add(tmp);
    const row = { case: c.id, kind: c.kind, task: c.task, mutant: c.name, file: c.file, variant: c.variant ?? null, mutated: c.kind === 'mutant' ? { start: c.start, end: c.end } : null, order: c.order, run: runInfo, detected: null, falsePositive: null, source: null, wide: false, unparsed: false, findingsTotal: 0, findings: [], outcome: 'invalid', reason: '', costUsd: 0, durationMs: 0, models: [] };
    try {
      const { ws } = buildCase(c, tmp, cost, task);
      const sink = createSink(path.join(caseDir, 'stream.jsonl'), { token, canary: task.canary, task: c.task, absAb: AB, ownTmp: tmp, maxBytes: MAX_STREAM });
      sink.turn();
      const argv = claudeArgv({ arm: 'somi', prompt: promptFor(task), budget: args.perCall, plugin, resume: null, model: args.model });
      const launch = sandboxOn ? { command: 'bwrap', args: sandboxArgs({ ...spec, rw: [tmp] }, claude, argv) } : { command: claude, args: argv };
      const childEnvVars = childEnv({ token, tmp });
      const started = Date.now();
      let r;
      try { r = await runClaude({ ...launch, env: childEnvVars, cwd: ws, sink, timeoutMs: args.timeoutMin * 60000, kills, fdToken: null }); } finally { await sweepProcesses(`CLAUDE_CONFIG_DIR=${childEnvVars.CLAUDE_CONFIG_DIR}`); sink.end(); }
      const res = sink.state.result;
      const stderr = redactToken(r.stderr, token);
      fs.writeFileSync(path.join(caseDir, 'stderr.txt'), stderr.slice(0, 64 * 1024), { mode: 0o600 });
      const streamFile = path.join(caseDir, 'stream.jsonl');
      const lim = accountLimit(streamFile);
      // The sink's own limit flag also fires on reviewer prose; only the stream's result / rate-limit events count here.
      const run = { error: r.error, leaks: [...sink.state.leaks].sort(), capped: sink.state.capped, timedOut: r.timedOut, limit: lim !== null, stderr, result: res, cost: Number.isFinite(res?.total_cost_usd) ? res.total_cost_usd : 0, exhausted: false, text: sink.state.text };
      Object.assign(row, classify({ run, arm: 'bare', budget: args.perCall }), { costUsd: run.cost, durationMs: Date.now() - started, models: Object.keys(res?.modelUsage ?? {}).sort().slice(0, 5) });
      if (!res && !r.error) Object.assign(row, { costUsd: args.perCall, costEstimated: true });
      if (row.reason === 'account-limit') row.resetText = lim?.reset ?? null;
      if (row.reason === 'account-limit' || row.reason === 'bg-wait-ceiling') st.halt = `${c.id}: ${row.reason}${lim?.reset ? `, resets ${lim.reset}` : ''}`;
      if (row.reason.startsWith('leak:')) st.halt = `${c.id}: ${row.reason}`; // includes leak:token and leak:canary
      if (row.costUsd > COST_HALT_FACTOR * args.perCall) st.halt = `${c.id}: one call cost $${row.costUsd.toFixed(2)}, more than ${COST_HALT_FACTOR} x the per-call cap`;
      if (st.interrupted) Object.assign(row, { outcome: 'invalid', reason: 'interrupted' });
      keepReviews(ws, caseDir, token);
      const sources = gather(streamFile, path.join(caseDir, 'reviews'));
      fs.writeFileSync(path.join(caseDir, 'reviewer.txt'), redactToken(SOURCES.map((k) => `=== ${k} ===\n${sources[k]}`).join('\n'), token).slice(0, MAX_KEPT_TEXT), { mode: 0o600 });
      const j = judge(c, sources);
      Object.assign(row, { unparsed: j.unparsed, findingsTotal: j.total, findings: j.findings, source: j.source, wide: j.wide });
      if (row.outcome === 'scored') { if (c.kind === 'mutant') row.detected = j.hit; else row.falsePositive = j.hit; }
    } catch (e) { row.reason = `case-fault: ${String(e?.message ?? e).slice(0, 120)}`; } finally {
      if (args.keep) { try { fs.rmSync(path.join(tmp, 'cfg'), { recursive: true, force: true }); redactTree(tmp, token); } catch { /* best effort */ } } else fs.rmSync(tmp, { recursive: true, force: true });
      liveTmp.delete(tmp);
    }
    return row;
  }

  for (const c of cases) {
    if (prior.get(c.id)?.outcome === 'scored') { console.log(`skip ${c.id}: already scored`); continue; }
    if (st.halt || st.interrupted) break;
    if (st.spent + args.perCall > args.budgetTotal) { st.budgetStop = true; break; }
    console.log(`start ${c.id} (${c.kind} ${c.task} ${c.file ?? c.variant})`);
    const row = await runCase(c);
    st.spent += row.costUsd;
    fs.appendFileSync(resultsFile, `${JSON.stringify(row)}\n`, { mode: 0o600 });
    console.log(`done ${c.id}: ${row.outcome}${row.reason ? ` (${row.reason})` : ''}${row.kind === 'mutant' ? ` detected ${row.detected}` : ` false-positive ${row.falsePositive}`} unparsed ${row.unparsed} $${row.costUsd.toFixed(2)} spent $${st.spent.toFixed(2)}`);
    if (row.outcome === 'invalid' && !st.halt) { if (st.lastInvalid === row.reason) st.halt = `${c.id}: two consecutive invalid rows with the same reason (${row.reason})`; st.lastInvalid = row.reason; } else if (row.outcome !== 'invalid') st.lastInvalid = null;
  }
  const report = summary(readRows(resultsFile), new Set(cases.map((c) => c.id)));
  fs.writeFileSync(path.join(out, 'report.txt'), `${report}\n`, { mode: 0o600 });
  console.log(`\n${report}\nresults: ${resultsFile}`);
  if (st.halt) { process.stderr.write(`review-recall: HALTED, ${st.halt}\n`); return 1; }
  if (st.budgetStop) { process.stderr.write(`review-recall: BUDGET STOP, spent $${st.spent.toFixed(2)} and the next call could cost $${args.perCall.toFixed(2)} against $${args.budgetTotal.toFixed(2)}; the remaining cases were not run\n`); return 3; }
  return st.interrupted ? 130 : 0;
}

main().then((c) => process.exit(c), (e) => die(`unexpected failure: ${String(e?.message ?? e).slice(0, 200)}`, 1));
