#!/usr/bin/env node
// The step tool's leniency: the calls a model makes by habit (no files, host and project_dir on every call, no review file, an
// extra key on a finding, a progress table of its own columns, a diary with only its heading) go through, each where it loses no
// gate. First one scripted pass through the real server on a copy of the task02 eval fixture, counting refused calls; then the
// edges in-process: what stays refused. Run by tests/scripts/loop-engine.sh.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { McpClient } from './somi-mcp-client.mjs';
import { runStep } from '../../../scripts/lib/loop-step.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURE = path.join(ROOT, 'tests', 'evals', 'fixtures', 'task02-code');
let pass = 0; let fail = 0;
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
};
const tmp = mkdtempSync(path.join(tmpdir(), 'loop-lenient-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
// A git repo holding a copy of the fixture, its _somi directory as .somi.
function fixture() {
  const root = path.join(tmp, `r${n++}`);
  cpSync(FIXTURE, root, { recursive: true });
  cpSync(path.join(FIXTURE, '_somi'), path.join(root, '.somi'), { recursive: true }); rmSync(path.join(root, '_somi'), { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'base');
  return root;
}
const plan = (root, ...p) => path.join(root, '.somi', 'plans', 'expired-token', ...p);
const text = (f) => { try { return readFileSync(f, 'utf8'); } catch { return '{}'; } }; // a file the code under test did not write reads as empty, so the check fails instead of the run
const CAPS_OFF = { SOMI_CODE_LOOP_MAX_PASSES: '', SOMI_CODE_LOOP_DIFF_CAP: '', SOMI_CODE_LOOP_REVIEW: '', SOMI_CODE_LOOP_REVIEW_SCOPE: '', SOMI_CODE_LOOP_SEVERITY_FLOOR: '', SOMI_GLOBAL_CONFIG: '' };

console.log('== one pass through the server on the task02 fixture, with every habit of the model ==');
{
  const root = fixture(); const calls = [];
  const client = new McpClient(path.join(ROOT, 'scripts', 'somi-mcp.mjs'), { env: { ...CAPS_OFF, CLAUDE_PROJECT_DIR: root } });
  try {
    await client.initialize({});
    const call = async (step, args) => { // host and project_dir ride on every call, as a model sends them
      const r = await client.request('tools/call', { name: 'somi_loop', arguments: { step, slug: 'expired-token', iteration: '1.1', host: 'claude-code', project_dir: root, ...args } });
      const body = JSON.parse(r.content[0].text); calls.push({ step, refused: r.isError === true, exit: body.exit, error: body.error }); return body;
    };
    const o = await call('open');
    writeFileSync(path.join(root, 'src', 'auth', 'token.mjs'), `${text(path.join(root, 'src', 'auth', 'token.mjs'))}// expiry checked\n`);
    await call('after-code', { agent: 'somi-coder' });
    const finding = { file: 'src/auth/token.mjs', title: 'no test for the boundary second', severity: 'Minor', confidence: 'High', rationale: 'a key the ledger has no use for', line: 12 };
    const ar = await call('after-review', { reviewers: ['somi-reviewer'], verdict: 'approve-with-comments', blockers: 0, majors: 0, findings: [finding], fixed: [] });
    const cl = await call('close', { status: ar.close_args?.status });
    const state = JSON.parse(text(path.join(root, '.somi', 'somi-state', 'loop', 'expired-token.1.1.json')));
    const row = text(plan(root, 'progress.md')).split('\n').find((l) => l.startsWith('| 1.1 |'));
    const titles = text(plan(root, 'diary.md')).split('\n').filter((l) => l.startsWith('## ')).map((l) => l.split(' — ')[1]);
    check('no call of the pass is refused', calls.filter((c) => c.refused), []);
    check('open took the scope from the "Files (approx)" line of the phase file', state.iteration_files, ['src/auth/token.mjs', 'tests/auth/token.test.mjs', '.somi/plans/expired-token/progress.md', '.somi/plans/expired-token/diary.md']);
    check('the pass ended done, and the card the coder is briefed with lists those files', [state.status, cl.status, o.brief?.includes('src/auth/token.mjs')], ['done', 'done', true]);
    check('the tool wrote the three diary entries into the header-only diary', titles, ['code-loop done at pass 1; verdict approve-with-comments', 'code-loop pass 1 reviewed: approve-with-comments', 'code-loop started for iteration 1.1']);
    check('the four-column row was updated in place (Status done, Reviewed the verdict) and the file keeps its other sections', [/\| 1\.1 \| Reject an expired token \| done +\| approve-with-comments +\|$/.test(row), text(plan(root, 'progress.md')).includes('## Currently in flight')], [true, true]);
    check('the finding with an extra key is in the ledger without it', [(JSON.parse(text(path.join(root, '.somi', 'reviews', 'expired-token', 'findings.json'))).findings ?? []).map((f) => [f.title, 'rationale' in f, 'line' in f])], [[['no test for the boundary second', false, false]]]);
  } finally { client.close(); }
}

console.log('== what stays refused ==');
{
  const root = fixture();
  const ctx = { root, env: { SOMI_GLOBAL_CONFIG: '' }, stateDir: path.join(root, '.somi', 'somi-state', 'loop'), installRoot: ROOT, via: 'mcp' };
  const step = (args) => runStep(ctx, { slug: 'expired-token', iteration: '1.1', ...args });
  const phase = plan(root, 'phases', '01-reject-expired.md'); const phaseText = text(phase); const progress = plan(root, 'progress.md'); const progressText = text(progress);
  const refusal = (r) => [r.exit, r.error?.split(':')[0]];
  writeFileSync(phase, phaseText.replace('src/auth/token.mjs`, `tests', '../evil`, `tests'));
  check('a derived path is checked as a given one: a .. segment is refused naming files', refusal(step({ step: 'open' })), [64, 'files']);
  writeFileSync(phase, phaseText.replace('- **Files (approx)**', '- **Files**'));
  check('a phase file without the Files (approx) line still refuses a missing files argument', [step({ step: 'open' }).error], ['files: required to start a code loop']);
  writeFileSync(phase, phaseText.replace('### Iteration 1.1', '### Iteration 1.2'));
  check('the line of another iteration is not taken for this one', [step({ step: 'open' }).error], ['files: required to start a code loop']);
  rmSync(phase);
  check('no phase file: the same refusal', [step({ step: 'open' }).error], ['files: required to start a code loop']);
  writeFileSync(phase, phaseText);
  const own = step({ step: 'open', files: ['src/auth/session.mjs'] });
  check('an explicit files argument wins over the phase file', [own.ok, JSON.parse(text(path.join(root, '.somi', 'somi-state', 'loop', 'expired-token.1.1.json'))).iteration_files], [true, ['src/auth/session.mjs']]);

  const other = fixture(); const oc = { ...ctx, root: other, stateDir: path.join(other, '.somi', 'somi-state', 'loop') };
  const attempt = (progressBody) => { writeFileSync(plan(other, 'progress.md'), progressBody); rmSync(oc.stateDir, { recursive: true, force: true }); const r = runStep(oc, { step: 'open', slug: 'expired-token', iteration: '1.1' }); return [r.exit, r.stop_reason]; };
  check('a table with the row missing is not-declared; so are one marked done, one with another row width and one with no heading', [attempt(progressText.replace('| 1.1 | Reject an expired token | not-started | — |', '| 1.2 | x | not-started | — |')), attempt(progressText.replace('not-started', 'done')), attempt(progressText.replace('not-started | — |', 'not-started |')), attempt(progressText.replace('## Iteration progress', '## Iterations'))], Array(4).fill([64, 'not-declared']));
  check('a row a person marked blocked still starts, as before', attempt(progressText.replace('not-started', 'blocked')), [0, null]);

  const lone = fixture(); const lc = { ...ctx, root: lone, stateDir: path.join(lone, '.somi', 'somi-state', 'loop') };
  const go = (args) => runStep(lc, { slug: 'expired-token', iteration: '1.1', ...args });
  go({ step: 'open' });
  check('host and project_dir are ignored on every step, even with a value the step would refuse; any other foreign key is still refused', [go({ step: 'status', host: 'vim', project_dir: '/x' }).ok, go({ step: 'status', bogus: 1 }).error, go({ step: 'close', host: 'claude-code', status: 'stopped-user-stop' }).ok], [true, 'bogus: is not an argument of step status', true]);
  const bad = fixture(); const bc = { ...ctx, root: bad, stateDir: path.join(bad, '.somi', 'somi-state', 'loop') };
  runStep(bc, { step: 'open', slug: 'expired-token', iteration: '1.1' }); writeFileSync(path.join(bad, 'src', 'auth', 'token.mjs'), 'x\n');
  runStep(bc, { step: 'after-code', slug: 'expired-token', iteration: '1.1', agent: 'somi-coder' });
  const rv = (over) => runStep(bc, { step: 'after-review', slug: 'expired-token', iteration: '1.1', reviewers: ['somi-reviewer'], verdict: 'request-changes', blockers: 0, majors: 1, findings: [{ file: 'a.js', title: 't', severity: 'Major' }], ...over });
  const ledgerOf = () => JSON.parse(text(path.join(bad, '.somi', 'reviews', 'expired-token', 'findings.json'))).findings ?? [];
  check('a finding is still refused for a missing field or a bad value, each naming the field and the index, and a review name with a path is still refused', [{ findings: [{ file: 'a.js', severity: 'Major', extra: 1 }] }, { findings: [{ file: 'a.js', title: 't', severity: 'Huge' }] }, { findings: [{ file: 'a.js', title: 't', severity: 'Major' }, { file: 'b.js', title: 't', severity: 'Major', confidence: 'certain secret' }] }, { findings: ['x'] }, { review: 'a/b.md' }].map((o) => rv(o).error), ['findings[0].title: is required', 'findings[0].severity: must be one of Blocker|Major|Minor|Nit', 'findings[1].confidence: must be one of High|Medium|Low', 'findings[0]: must be an object {file, title, severity, symbol?, confidence?}', 'review: must be the review file name, without a path']);
  check('nothing was recorded by the refused calls', ledgerOf(), []);
  const first = rv({}); const again = rv({});
  const led = ledgerOf();
  check('with no review name the same one is generated for a retry of the pass: replayed, one finding, one sighting', [first.exit, again.replayed, led.length, led[0]?.seen.length, /^pass-1-\d{12}$/.test(led[0]?.introduced_by)], [0, true, 1, 1, true]);

  const low = fixture(); const lw = { ...ctx, root: low, stateDir: path.join(low, '.somi', 'somi-state', 'loop') };
  runStep(lw, { step: 'open', slug: 'expired-token', iteration: '1.1' }); writeFileSync(path.join(low, 'src', 'auth', 'token.mjs'), 'x\n');
  runStep(lw, { step: 'after-code', slug: 'expired-token', iteration: '1.1', agent: 'somi-coder' });
  const lower = runStep(lw, { step: 'after-review', slug: 'expired-token', iteration: '1.1', reviewers: ['somi-reviewer'], verdict: 'request-changes', blockers: 0, majors: 1, findings: [{ file: 'a.js', title: 'lower case', severity: 'major', confidence: 'high' }, { file: 'b.js', title: 'upper case', severity: 'MINOR', confidence: 'LOW' }] });
  const stored = (JSON.parse(text(path.join(low, '.somi', 'reviews', 'expired-token', 'findings.json'))).findings ?? []).map((f) => [f.title, f.severity, f.confidence]);
  check('severity and confidence in any letter case are recorded in the canonical spelling', [lower.exit, stored], [0, [['lower case', 'Major', 'High'], ['upper case', 'Minor', 'Low']]]);
}

console.log(`loop step leniency tests: ${pass} ok, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
