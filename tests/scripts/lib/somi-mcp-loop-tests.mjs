#!/usr/bin/env node
// Drives the real server (scripts/somi-mcp.mjs) over stdio for the somi_loop tool in throwaway git repos: a clean pass, every gate
// of the matrix, the refusals, the root rules, the argument rules, interop with the CLI and the writes it may make.
// Invoked from tests/scripts/somi-mcp.sh. CLAUDE_PROJECT_DIR is always set explicitly (or cleared), so the host a run happens in cannot change a case.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, symlinkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { McpClient } from './somi-mcp-client.mjs';
import { KINDS, NEXT } from '../../../scripts/lib/loop-exit.mjs';
import { LIMITS } from '../../../scripts/lib/loop-review.mjs';
import { callLoopStep } from '../../../scripts/lib/loop-step-tool.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let pass = 0; let fail = 0;
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
};
const tmp = mkdtempSync(path.join(tmpdir(), 'somi-mcp-loop-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
const ROWS = '# Progress — p1\n\n## Iteration progress\n\n| Iteration | Title | Status | Reviewed | Last activity |\n|---|---|---|---|---|\n| 1.1 | one | not-started | — | — |\n';
const DIARY = '# Diary — p1\n\n> Spec: x\n\n---\n\n## 2026-10-28 10:00 — Plan\n\n**Category**: `note`\n**Phase**: 1\n\nbody\n\n---\n\n';
let n = 0;
function repo(slugs = ['p1']) {
  const root = path.join(tmp, `r${n++}`); mkdirSync(root);
  const git = (...a) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q'); for (const f of ['a.js', 'b.js']) writeFileSync(path.join(root, f), '1\n'); git('add', '.'); git('commit', '-q', '-m', 'base');
  for (const s of slugs) { mkdirSync(path.join(root, '.somi', 'plans', s, 'phases'), { recursive: true }); writeFileSync(path.join(root, '.somi', 'plans', s, 'diary.md'), DIARY); writeFileSync(path.join(root, '.somi', 'plans', s, 'progress.md'), ROWS); }
  return root;
}
const file = (root, ...p) => path.join(root, ...p);
const diary = (root) => readFileSync(file(root, '.somi', 'plans', 'p1', 'diary.md'), 'utf8');
const entries = (root) => diary(root).split('\n').filter((l) => l.startsWith('## ')).length;
const state = (root) => JSON.parse(readFileSync(file(root, '.somi', 'somi-state', 'loop', 'p1.1.1.json'), 'utf8'));
// Every file under a directory with its hash: the "nothing was written" oracle.
const tree = (root) => Object.fromEntries(readdirSync(root, { recursive: true }).filter((f) => !f.startsWith('.git')).sort().map((f) => [f, lstatSync(path.join(root, f)).isFile() ? createHash('sha256').update(readFileSync(path.join(root, f))).digest('hex') : 'dir']));
const CAPS_OFF = { SOMI_CODE_LOOP_MAX_PASSES: '', SOMI_CODE_LOOP_DIFF_CAP: '', SOMI_PLAN_LOOP_MAX_PASSES: '', SOMI_GLOBAL_CONFIG: '' };
async function withClient(root, fn, { env = {}, roots } = {}) {
  const client = new McpClient(path.join(ROOT, 'scripts', 'somi-mcp.mjs'), { env: { ...CAPS_OFF, CLAUDE_PROJECT_DIR: root ?? '', ...env } });
  if (roots) client.rootsHandler = async () => roots;
  try { await client.initialize(roots ? { roots: {} } : {}); return await fn(client); } finally { client.close(); }
}
const sizes = []; const seen = { next: new Set(), kind: new Set() };
async function step(c, name, args = {}) {
  const r = await c.request('tools/call', { name: 'somi_loop', arguments: { step: name, slug: 'p1', iteration: '1.1', ...args } });
  const text = r?.content?.[0]?.text ?? ''; sizes.push(Buffer.byteLength(text));
  const got = JSON.parse(text); seen.next.add(got.next); for (const u of got.unwritten ?? []) seen.kind.add(u.kind);
  return { err: r.isError === true, ...got };
}
const review = (v = 'approve', extra = {}) => ({ reviewers: ['somi-reviewer'], verdict: v, blockers: 0, majors: 0, review: 'r1.md', ...extra });
const MAJOR = { file: 'a.js', symbol: 'f', title: 'the same defect', severity: 'Major', confidence: 'High' };
const gate = (r) => [r.err, r.exit, r.stop_reason];

console.log('== somi_loop over MCP ==');
{
  const root = repo();
  await withClient(root, async (c) => {
    const t = (await c.request('tools/list', {})).tools.find((x) => x.name === 'somi_loop');
    check('tools/list: somi_loop requires step and slug; its description is at most 900 bytes and the whole definition at most 2850', [t.inputSchema.required, Buffer.byteLength(t.description) <= 900, Buffer.byteLength(JSON.stringify(t)) <= 2850], [['step', 'slug'], true, true]);
    const o = await step(c, 'open', { files: ['a.js'] }); writeFileSync(file(root, 'a.js'), '1\n2\n3\n');
    check('open starts pass 1: the run card is the brief, the caps are the defaults, the server wrote the diary and the row', [o.err, o.exit, o.pass, o.next, o.brief.startsWith('```somi-card'), o.caps, o.wrote], [false, 0, 1, 'task-coder', true, { max_passes: 3, diff_cap_lines: 400, severity_floor: 'Major' }, ['.somi/plans/p1/diary.md', '.somi/plans/p1/progress.md']]);
    const cli = JSON.parse(execFileSync(process.execPath, [file(ROOT, 'scripts', 'somi-loop.mjs'), 'resume', '--slug', 'p1', '--iteration', '1.1'], { env: { ...process.env, ...CAPS_OFF, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' }));
    check('init through the tool, resume through the CLI: the CLI reads the same running state', [cli.status, cli.pass, cli.iteration_files], ['running', 1, ['a.js']]);
    const ac = await step(c, 'after-code', { agent: 'somi-coder' });
    check('after-code records the coder and passes the diff gate', [ac.err, ac.exit, ac.next, ac.diff.cap, ac.changed], [false, 0, 'task-reviewer', 400, true]);
    const ar = await step(c, 'after-review', review());
    const cl = await step(c, 'close', { status: ar.close_args.status });
    const row = readFileSync(file(root, '.somi', 'plans', 'p1', 'progress.md'), 'utf8').split('\n').find((l) => l.startsWith('| 1.1 |'));
    check('after-review ends the loop clean, close writes it down: status done, the row is done, reviewed approve', [ar.next, cl.status, cl.next, state(root).status, / done /.test(row), / approve /.test(row)], ['close', 'done', 'summarise', 'done', true, true]);
    const own = diary(root).split(/^(?=## )/m).slice(1, -1);
    check('every entry the tool wrote carries the fixed provenance line and a note or blocker category', [own.length, own.every((e) => e.includes('\nWritten by the loop step engine; every field comes from stored loop state.\n') && /\*\*Category\*\*: `(note|blocker)`/.test(e))], [3, true]);
    const before = tree(root); const again = await step(c, 'open', { files: ['a.js'] }); for (let i = 0; i < 9; i++) await step(c, 'status');
    check('a finished loop is not restarted by the tool; ten more calls (status included) write nothing', [again.exit, again.stop_reason, again.next, tree(root)], [64, 'no-running-loop', 'ask-user', before]);
  });
}
console.log('== the gate matrix ==');
{
  const root = repo(); writeFileSync(file(root, 'a.js'), '1\n2\n3\n');
  await withClient(root, async (c) => {
    await step(c, 'open', { files: ['a.js'], max_passes: 1 });
    await step(c, 'after-code', { agent: 'somi-coder' });
    const ar = await step(c, 'after-review', review('request-changes', { majors: 1, findings: [MAJOR] }));
    const stop = await step(c, 'open');
    check('exit 2: past the pass cap the result carries the gate (not an error), and the CLI command that re-runs it', [ar.next, ...gate(stop), stop.next, stop.cli], [ 'open', false, 2, 'max-passes-exceeded', 'close', 'node scripts/somi-loop.mjs pass --slug p1 --iteration 1.1 --max-passes <N>']);
  });
  const two = repo(); writeFileSync(file(two, 'a.js'), '1\n2\n3\n');
  await withClient(two, async (c) => {
    await step(c, 'open', { files: ['a.js'] }); await step(c, 'after-code', { agent: 'somi-coder' });
    await step(c, 'after-review', review('request-changes', { majors: 1, findings: [MAJOR] })); await step(c, 'open'); await step(c, 'after-code', { agent: 'somi-coder' });
    const br = await step(c, 'after-review', review('request-changes', { majors: 1, findings: [MAJOR] }));
    check('exit 5: the same finding on consecutive passes trips the circuit breaker, as a result with stop_reason', [br.err, br.exit, br.stop_reason, br.next, br.close_args], [false, 5, 'circuit-breaker', 'close', { status: 'stopped-circuit-breaker' }]);
  });
  for (const [label, touch, want] of [['exit 3 with scope-expansion: lines outside the declared files', 'b.js', [false, 3, 'scope-expansion']], ['exit 3 without: lines inside the declared files', 'a.js', [false, 3, 'diff-cap-exceeded']]]) {
    const r = repo();
    await withClient(r, async (c) => {
      await step(c, 'open', { files: ['a.js'], diff_cap: 5 }); writeFileSync(file(r, touch), `${'x\n'.repeat(20)}`);
      const s = await step(c, 'after-code', { agent: 'somi-coder' });
      check(label, [...gate(s), s.diff.weighted_lines > 5, s.cli.includes('--diff-cap <N>')], [...want, true, true]);
    });
  }
  const timed = repo(); mkdirSync(file(timed, '.somi', 'somi-state', 'run'), { recursive: true }); writeFileSync(file(timed, '.somi', 'somi-state', 'run', 'p1.json'), JSON.stringify({ started: '2020-01-01T00:00:00Z', max_minutes: 1 }));
  await withClient(timed, async (c) => check('exit 4: a run past its time budget stops the open', gate(await step(c, 'open', { files: ['a.js'] })), [false, 4, 'time-budget']));
  const brief = repo(['p1', 'bo']); rmSync(file(brief, '.somi', 'plans', 'bo', 'phases'), { recursive: true }); writeFileSync(file(brief, '.somi', 'plans', 'bo', 'brief.md'), '# brief\n'); writeFileSync(file(brief, '.somi', 'plans', 'bo', 'progress.md'), ROWS);
  await withClient(brief, async (c) => {
    const b = await step(c, 'open', { slug: 'bo', files: ['a.js'] });
    check('exit 64: a brief-only work item without its tier record is refused', [b.err, b.exit, /brief-only/.test(b.error)], [true, 64, true]);
    const run = await step(c, 'open', { files: ['a.js'] });
    const sentinel = await step(c, 'after-code', { agent: 'somi-no-such-agent' });
    check('exit 65: an agent the resolver does not know', [sentinel.err, sentinel.exit], [true, 65]);
    const snapshot = tree(brief);
    const bads = await Promise.all([{ step: 'nope' }, { step: 'open', now: '2020-01-01T00:00' }, { step: 'open', reviewed: 'approve' }, { step: 'open', activity: 'x' }, { step: 'open', status: 'done' }, { step: 'open', failAfter: 'pass' }, { step: 'open', max_passes: 9 }, { step: 'open', diff_cap: 999 }, { step: 'open', slug: '../x' }, { step: 'status', iteration: '1.1/../x' }].map((a) => step(c, a.step, a)));
    check('exit 64: an unknown step, a clock, a row field or a foreign field, a cap above the stored one, a traversal slug or iteration; nothing is written', [bads.map((x) => [x.err, x.exit]), tree(brief), run.pass], [bads.map(() => [true, 64]), snapshot, 1]);
  });
  const quota = repo();
  await withClient(quota, async (c) => {
    const first = await step(c, 'open', { files: ['a.js'] }); const n1 = entries(quota);
    for (let i = 0; i < 10; i++) await step(c, 'open', { files: ['a.js'] });
    check('a call repeated eleven times records one pass and one diary entry (replayed from the second call)', [first.replayed, (await step(c, 'open', { files: ['a.js'] })).replayed, entries(quota) === n1, state(quota).history.length, state(quota).pass], [false, true, true, 0, 1]);
  });
}
console.log('== the root and the environment ==');
{
  const host = repo(); const other = repo(); const lone = repo();
  await withClient(host, async (c) => {
    const before = tree(other); const out = await step(c, 'open', { files: ['a.js'], project_dir: other });
    check('a project_dir outside the host root is refused 64 and nothing is written there', [out.err, out.exit, /outside the host-supplied root/.test(out.error), tree(other)], [true, 64, true, before]);
    const inside = path.join(host, 'sub'); mkdirSync(file(inside, '.somi', 'plans', 'p1', 'phases'), { recursive: true });
    for (const [f, text] of [['diary.md', DIARY], ['progress.md', ROWS]]) writeFileSync(file(inside, '.somi', 'plans', 'p1', f), text);
    const opened = await step(c, 'open', { files: ['a.js'], project_dir: inside }); const viaDir = await step(c, 'status', { project_dir: inside }); const viaHost = await step(c, 'status');
    check('a project_dir inside the host root selects that project: the loop opened through it is found through it only', [opened.err, opened.pass, viaDir.pass, viaHost.exit, existsSync(file(inside, '.somi', 'somi-state', 'loop', 'p1.1.1.json')), existsSync(file(host, '.somi', 'somi-state'))], [false, 1, 1, 64, true, false]);
  });
  await withClient(host, async (c) => {
    const w = await step(c, 'open', { files: ['a.js'] });
    check('a server env cap is inert: the cap in force is the default, not SOMI_CODE_LOOP_MAX_PASSES=1', [w.err, w.caps.max_passes], [false, 3]);
  }, { env: { SOMI_CODE_LOOP_MAX_PASSES: '1' } });
  await withClient('', async (c) => {
    const w = await step(c, 'open', { files: ['a.js'], project_dir: lone }); const snapshot = tree(lone);
    const snapshot2 = tree(host); const r = await step(c, 'status', { project_dir: host });
    check('no host root (no CLAUDE_PROJECT_DIR, no roots): a write step is refused 67 pointing at the CLI and creates nothing', [w.err, w.exit, /run the loop through the CLI/.test(w.error), tree(lone)], [true, 67, true, snapshot]);
    check('no host root: status reads a project_dir and writes nothing', [r.err, r.pass, r.state.status, tree(host)], [false, 1, 'running', snapshot2]);
  });
  const a = repo(); const b = repo();
  await withClient('', async (c) => {
    const amb = await step(c, 'open', { files: ['a.js'] }); const sel = await step(c, 'open', { files: ['a.js'], project_dir: a });
    check('two roots and no project_dir are refused as ambiguous (67); project_dir selects one of them', [amb.err, amb.exit, /ambiguous/.test(amb.error), sel.err, sel.pass, tree(b)['.somi/somi-state'] === undefined], [true, 67, true, false, 1, true]);
  }, { roots: [a, b] });
}
console.log('== the files a model names, the writes that fail, the budget ==');
{
  const root = repo();
  await withClient(root, async (c) => {
    const o = await step(c, 'open', { files: ['a.js', 'x<!--y.js', '![i](u).js'] });
    check('a file name never reaches the diary (only a count does), so it cannot open a comment or an image there', [o.err, diary(root).includes('<!--'), diary(root).includes('![i]'), diary(root).includes('files in scope: 3')], [false, false, false, true]);
  });
  const ro = repo();
  if (process.getuid?.() === 0) console.log('  skip a failed diary write is handed back as unwritten (running as root: a read-only directory is writable)');
  else {
    chmodSync(file(ro, '.somi', 'plans', 'p1'), 0o555);
    await withClient(ro, async (c) => {
      const w = await step(c, 'open', { files: ['a.js'] }); const again = await step(c, 'open', { files: ['a.js'] });
      check('a diary write that failed is a normal result whose unwritten items name the file and the kind of record; a repeat replays it', [w.err, w.exit, w.unwritten.map((u) => [u.reason, u.file, u.kind]), again.replayed], [false, 0, [['write-failed', 'diary.md', 'diary-entry'], ['write-failed', 'progress.md', 'iteration-row']], true]);
    });
    chmodSync(file(ro, '.somi', 'plans', 'p1'), 0o755);
  }
  check(`every response in this file fit the 2.5 KB budget (largest ${Math.max(...sizes)} bytes)`, sizes.every((s) => s <= 2500), true);
  const stub = repo(); const bare = tree(stub); const stubbed = await callLoopStep({ step: 'open', slug: 'p1', iteration: '1.1', files: ['a.js'] }, { resolveRoot: async () => ({ ok: true, root: stub }), env: {}, installRoot: ROOT });
  check('a resolver result that does not say hosted is not taken as hosted: a write step is refused 67 and writes nothing', [stubbed.isError, JSON.parse(stubbed.text).exit, tree(stub)], [true, 67, bare]);
}
console.log('== one result shape, the root once, the environment, the state directory ==');
{
  const r = repo(); const roots = repo(); const outside = repo();
  await withClient(r, async (c) => {
    await step(c, 'open', { files: ['a.js'] });
    const a66 = await step(c, 'after-code', { agent: 'somi' });
    writeFileSync(file(r, '.somi', 'config.json'), '{ not json');
    const a67 = await step(c, 'after-code', { agent: 'somi-coder' });
    check('exits 66 (agent somi) and 67 (a corrupt .somi/config.json) are refusals, in the one JSON shape with next and exit', [a66, a67].map((x) => [x.err, x.exit, x.ok, x.next, typeof x.error]), [[true, 66, false, null, 'string'], [true, 67, false, null, 'string']]);
  });
  await withClient('', async (c) => {
    let asked = 0; c.rootsHandler = async () => (asked++ ? [] : [roots]);
    const before = tree(outside); const out = await step(c, 'open', { files: ['a.js'], project_dir: outside });
    check('the root is asked for once: a second roots/list that returns nothing cannot hand the root to project_dir', [out.err, out.exit, asked, tree(outside)], [true, 64, 1, before]);
  }, { roots: true });
  const rev = repo(); const gcfg = path.join(tmp, 'global.json'); writeFileSync(gcfg, '{"code_loop":{"max_passes":2}}');
  await withClient(rev, async (c) => {
    const o = await step(c, 'open', { files: ['a.js'] }); const ac = await step(c, 'after-code', { agent: 'somi-coder' });
    check('the review mode, review scope and severity floor in the server env reach the loop, the diff-cap variable does not, and SOMI_GLOBAL_CONFIG does', [ac.review_mode, ac.next, ac.scope.scope, ac.scope.why, o.caps.severity_floor, o.caps.diff_cap_lines, o.caps.max_passes], ['security', 'task-reviewers', 'full', 'setting', 'Minor', 400, 2]);
  }, { env: { SOMI_CODE_LOOP_REVIEW: 'security', SOMI_CODE_LOOP_REVIEW_SCOPE: 'full', SOMI_CODE_LOOP_SEVERITY_FLOOR: 'Minor', SOMI_CODE_LOOP_DIFF_CAP: '5', SOMI_GLOBAL_CONFIG: gcfg } });
  const link = repo(); const away = path.join(tmp, 'away'); mkdirSync(away); mkdirSync(file(link, '.somi'), { recursive: true }); symlinkSync(away, file(link, '.somi', 'somi-state'));
  await withClient(link, async (c) => {
    const o = await step(c, 'open', { files: ['a.js'] });
    check('a state directory that is a link is refused 64 before any write: the directory it points to stays empty', [o.err, o.exit, readdirSync(away)], [true, 64, []]);
  });
  const evil = repo(); const H = '<!--x--> ![i](u) `c` [x](u) # > - ```';
  await withClient(evil, async (c) => {
    await step(c, 'open', { files: ['a.js', `${H}.js`.replace(/\s/g, '')] });
    await step(c, 'after-code', { agent: 'somi-coder' });
    const bad = await step(c, 'after-review', review('request-changes', { majors: 1, findings: [{ ...MAJOR, file: H, symbol: H, title: H }], reviewers: ['somi-reviewer', H] }));
    const ar = await step(c, 'after-review', review('request-changes', { majors: 1, findings: [{ ...MAJOR, file: H, symbol: H, title: H }] }));
    const cl = await step(c, 'close', { status: 'stopped-user-stop' });
    const added = (diary(evil).split(DIARY.slice(DIARY.indexOf('## ')))[0] + readFileSync(file(evil, '.somi', 'plans', 'p1', 'progress.md'), 'utf8')).replace(/`(note|blocker)`/g, '');
    check('hostile findings and a hostile reviewers entry run through open to close: refused or recorded, and diary.md and progress.md hold no markup from them', [bad.exit, ar.exit, cl.err, ['<!--', '![', '`', '[x](u)'].filter((m) => added.includes(m))], [64, 0, false, []]);
  });
}
console.log('== a git that does not answer, and the words the results use ==');
{
  const stuck = repo(); const fake = path.join(tmp, 'fakegit'); mkdirSync(fake); writeFileSync(path.join(fake, 'git'), '#!/bin/sh\nexec sleep 3\n', { mode: 0o755 });
  const call = async (args) => { const r = await callLoopStep({ slug: 'p1', iteration: '1.1', ...args }, { resolveRoot: async () => ({ ok: true, root: stuck, hosted: true }), env: { SOMI_GLOBAL_CONFIG: '' }, installRoot: ROOT }); return { err: r.isError, ...JSON.parse(r.text) }; };
  await call({ step: 'open', files: ['a.js'] });
  const [real, limit] = [process.env.PATH, LIMITS.gitTimeoutMs]; process.env.PATH = `${fake}:${real}`; LIMITS.gitTimeoutMs = 300;
  let ac; try { ac = await call({ step: 'after-code', agent: 'somi-coder' }); } finally { process.env.PATH = real; LIMITS.gitTimeoutMs = limit; }
  check('a git that does not answer within the limit is a refusal (64 saying so), never a diff gate pass; no review is asked for', [ac.err, ac.exit, ac.next, /git did not answer within 0\.3 seconds/.test(ac.error)], [true, 64, null, true]);
  check('every next and every unwritten kind this file saw is one the engine owns', [[...seen.next].filter((x) => x !== null && !NEXT.includes(x)), [...seen.kind].filter((x) => x !== undefined && !KINDS.includes(x))], [[], []]);
}
console.log(`somi_loop tests: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
