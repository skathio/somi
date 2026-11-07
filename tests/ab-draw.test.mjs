// The draw driver's two judgements a run rests on: the eval token is read only from an owner-only file holding exactly one line,
// and each draw gets one outcome, decided by the first rule that matches, so a leak or an infrastructure failure is never scored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from './helpers.mjs';
import { classify, prepareWorkspace, readEnvFile, runDraw } from './evals/lib/ab-draw.mjs';

const TOKEN = 'tok_ABCDEFGHIJKLMNOP_qrstuv-0123';

function envFile(t, text, mode = 0o600) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-env-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'eval.env');
  fs.writeFileSync(file, text, { mode });
  fs.chmodSync(file, mode);
  return file;
}

test('the token is read from one line, quoted or not, with comments and blank lines around it', (t) => {
  for (const text of [`CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}\n`, `# eval\n\nexport CLAUDE_CODE_OAUTH_TOKEN="${TOKEN}"\n`, `  CLAUDE_CODE_OAUTH_TOKEN='${TOKEN}'  `]) {
    assert.deepEqual(readEnvFile(envFile(t, text)), { ok: true, token: TOKEN }, text);
  }
});

test('anything but one well-formed token line is refused, without echoing the file', (t) => {
  const one = 'the env file must hold exactly one line CLAUDE_CODE_OAUTH_TOKEN=<value>';
  const malformed = 'the token is missing or malformed';
  const cases = [
    [`OTHER=x\nCLAUDE_CODE_OAUTH_TOKEN=${TOKEN}\n`, one],
    [`CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}\nCLAUDE_CODE_OAUTH_TOKEN=${TOKEN}\n`, one],
    [`claude_code_oauth_token=${TOKEN}\n`, one],
    [`CLAUDE_CODE_OAUTH_TOKEN="${TOKEN}'\n`, malformed],
    ['CLAUDE_CODE_OAUTH_TOKEN=short\n', malformed],
    ['CLAUDE_CODE_OAUTH_TOKEN=has space in it 0123456789\n', malformed],
    [`CLAUDE_CODE_OAUTH_TOKEN=${'a'.repeat(513)}\n`, malformed],
    ['# nothing\n', malformed],
  ];
  for (const [text, reason] of cases) assert.deepEqual(readEnvFile(envFile(t, text)), { ok: false, reason }, reason);
});

test('the file must be a regular, owner-only file of at most 4096 bytes', (t) => {
  const good = `CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}\n`;
  for (const mode of [0o640, 0o604, 0o700 | 0o060]) assert.deepEqual(readEnvFile(envFile(t, good, mode)), { ok: false, reason: 'the env file must not be accessible to group or others (mode 0600)' }, mode.toString(8));
  assert.deepEqual(readEnvFile(envFile(t, `${good}#${'x'.repeat(4096)}`)), { ok: false, reason: 'the env file is larger than 4096 bytes' });
  const file = envFile(t, good);
  const link = `${file}.link`;
  fs.symlinkSync(file, link);
  assert.deepEqual(readEnvFile(link), { ok: false, reason: 'the env file is not a regular file' });
  assert.deepEqual(readEnvFile(path.dirname(file)), { ok: false, reason: 'the env file is not a regular file' });
  assert.deepEqual(readEnvFile(`${file}.missing`), { ok: false, reason: 'the env file could not be read' });
  t.mock.method(process, 'getuid', () => 12345);
  assert.deepEqual(readEnvFile(file), { ok: false, reason: 'the env file is not owned by the current user' });
});

test('a file that changes between the check and the open is refused, and the handle is closed', (t) => {
  const file = envFile(t, `CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}\n`);
  const open = new Set();
  const realOpen = fs.openSync; const realClose = fs.closeSync;
  t.mock.method(fs, 'openSync', (...a) => { const fd = realOpen(...a); open.add(fd); fs.chmodSync(file, 0o644); return fd; });
  t.mock.method(fs, 'closeSync', (fd) => { open.delete(fd); realClose(fd); });
  assert.deepEqual(readEnvFile(file), { ok: false, reason: 'the env file changed while it was opened' });
  assert.equal(open.size, 0);
});

const RUN = { error: null, leaks: [], capped: false, timedOut: false, limit: false, stderr: '', cost: 0.5, exhausted: false, resumes: 0, text: 'Done.', result: { subtype: 'success', is_error: false, result: 'Done.' } };
const outcome = (change, budget = 2) => classify({ run: { ...RUN, ...change }, arm: 'bare', budget });

test('a finished draw is scored, with any other subtype as its reason', () => {
  assert.deepEqual(outcome({}), { outcome: 'scored', reason: '' });
  assert.deepEqual(outcome({ result: { subtype: 'error_during_execution' } }), { outcome: 'scored', reason: 'error_during_execution' });
  assert.deepEqual(outcome({ result: {} }), { outcome: 'scored', reason: 'no-subtype' });
  assert.deepEqual(outcome({ result: { subtype: 'x'.repeat(60) } }).reason.length, 40);
});

test('the first matching rule wins, so a leak or an infrastructure failure is never scored', () => {
  const invalid = (reason) => ({ outcome: 'invalid', reason });
  const all = { error: 'ENOENT', leaks: ['token', 'canary'], capped: true, timedOut: true, limit: true, stderr: 'Background tasks still running after 1s', result: null };
  const order = [
    [{}, invalid('spawn-error:ENOENT')],
    [{ error: null }, invalid('leak:token,canary')],
    [{ error: null, leaks: [] }, invalid('output-cap')],
    [{ error: null, leaks: [], capped: false }, invalid('timeout')],
    [{ error: null, leaks: [], capped: false, timedOut: false }, invalid('account-limit')],
    [{ error: null, leaks: [], capped: false, timedOut: false, limit: false }, invalid('bg-wait-ceiling')],
    [{ error: null, leaks: [], capped: false, timedOut: false, limit: false, stderr: '' }, invalid('no-result')],
    [{ error: null, leaks: [], capped: false, timedOut: false, limit: false, stderr: 'HTTP 401' }, invalid('auth')],
  ];
  for (const [change, expected] of order) assert.deepEqual(outcome({ ...all, ...change }), expected, expected.reason);
});

test('an auth failure, a spent budget and a waiting session are told apart', () => {
  assert.deepEqual(outcome({ stderr: 'Not logged in', result: { is_error: true, subtype: 'success' } }), { outcome: 'invalid', reason: 'auth' });
  assert.deepEqual(outcome({ result: { is_error: true, result: 'Please run /login', subtype: 'success' } }), { outcome: 'invalid', reason: 'auth' });
  assert.deepEqual(outcome({ result: { is_error: false, result: 'please run /login', subtype: 'success' } }), { outcome: 'scored', reason: '' }, 'login text without an error is not an auth failure');
  const over = { outcome: 'over-budget', reason: 'budget exhausted' };
  assert.deepEqual(outcome({ result: { subtype: 'error_max_budget_usd' } }), over);
  assert.deepEqual(outcome({ cost: 2.01 }), over);
  assert.deepEqual(outcome({ cost: 2 }), { outcome: 'scored', reason: '' }, 'spending exactly the budget is within it');
  assert.deepEqual(outcome({ exhausted: true }), over);
  assert.deepEqual(outcome({ text: 'Shall I go ahead?', resumes: 4 }), { outcome: 'paused', reason: 'still waiting after 4 resume(s)' });
  assert.deepEqual(outcome({ text: 'Shall I go ahead?', result: { subtype: 'error_during_execution' } }).outcome, 'scored', 'only a successful session can be waiting');
});

// A stand-in for the CLI: each call logs its argv and prints the events `events(n)` gives for the n-th call (1-based).
function stub(t, events, extra = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-draw-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'argv.jsonl');
  const file = path.join(dir, 'claude-stub');
  fs.writeFileSync(file, ['#!/usr/bin/env node', "const fs = require('node:fs');",
    `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    `const n = fs.readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').length;`,
    `const said = ${said.toString()};`, `const events = ${events.toString()};`, extra,
    'for (const e of events(n)) console.log(JSON.stringify(e));'].join('\n'), { mode: 0o755 });
  const drawDir = path.join(dir, 'draw');
  fs.mkdirSync(drawDir);
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  const draw = (opts = {}) => runDraw({ model: 'stub-1', arm: 'bare', prompt: 'Build it.', budget: 1, timeoutMs: 30000, claude: file, env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: path.join(dir, 'cfg') }, cwd: dir, drawDir, token: DRAW_TOKEN, canary: 'CANARYcanary0123456789', task: 'T-x', ownTmp: dir, kills: new Set(), ...opts });
  return { draw, calls };
}
const DRAW_TOKEN = 'tok_drawdrawdrawdraw0123';
const said = (text, n, cost = 0.01 * n) => [{ type: 'assistant', message: { content: [{ type: 'text', text }] } }, { type: 'result', subtype: 'success', session_id: 's1', result: text, num_turns: 1, total_cost_usd: cost, modelUsage: { [`model-${n}`]: {} } }];

test('a draw stops at the first call that cannot go on, and says why', async (t) => {
  const missing = await stub(t, () => []).draw({ claude: '/nonexistent/claude' });
  assert.deepEqual({ error: missing.error, cost: missing.cost, result: missing.result }, { error: 'ENOENT', cost: 0, result: null });
  const silent = stub(t, () => []);
  const none = await silent.draw({ followUps: ['more'] });
  assert.deepEqual({ calls: silent.calls().length, result: none.result }, { calls: 1, result: null });
  const failed = stub(t, (n) => [{ type: 'result', subtype: 'error_during_execution', session_id: 's1', total_cost_usd: 0.2 * n }]);
  const r = await failed.draw({ followUps: ['more'] });
  assert.deepEqual({ calls: failed.calls().length, cost: r.cost }, { calls: 1, cost: 0.2 });
  const limited = stub(t, (n) => [{ type: 'result', subtype: 'success', session_id: 's1', result: "You've hit your session limit · resets 5pm", total_cost_usd: 0.01 * n }]);
  const l = await limited.draw({ followUps: ['more'] });
  assert.deepEqual({ calls: limited.calls().length, limit: l.limit, reset: l.reset }, { calls: 1, limit: true, reset: '5pm' });
});

test('a draw that keeps asking is resumed at most maxResumes times', async (t) => {
  const asking = stub(t, (n) => said('Shall I continue?', n));
  const r = await asking.draw({ maxResumes: 2 });
  assert.deepEqual({ calls: asking.calls().length, resumes: r.resumes, text: r.text, turns: r.turns, models: r.models, exhausted: r.exhausted }, { calls: 3, resumes: 2, text: 'Shall I continue?', turns: 3, models: ['model-1', 'model-2', 'model-3'], exhausted: false });
});

test('a follow-up is not sent when too little budget is left for it', async (t) => {
  const pricey = stub(t, (n) => said('Done.', n, 0.95));
  const r = await pricey.draw({ followUps: ['more'] });
  assert.deepEqual({ calls: pricey.calls().length, exhausted: r.exhausted, followUps: r.followUps }, { calls: 1, exhausted: true, followUps: 0 });
  const argv = pricey.calls()[0];
  assert.equal(argv[argv.indexOf('--max-budget-usd') + 1], '1.00');
});

test('the token never leaves a draw: stderr is redacted and a token in the stream is a leak', async (t) => {
  const loud = stub(t, (n) => said(`echo ${process.env.T}`, n), `process.env.T = ${JSON.stringify(DRAW_TOKEN)}; console.error('stderr ' + ${JSON.stringify(DRAW_TOKEN)});`);
  const r = await loud.draw();
  assert.deepEqual({ leaks: r.leaks, stderr: r.stderr.trim() }, { leaks: ['token'], stderr: 'stderr [REDACTED]' });
});

test('a draw that runs past its time is stopped and marked', async (t) => {
  const slow = stub(t, () => [], 'setInterval(() => {}, 1000);');
  const r = await slow.draw({ timeoutMs: 1000 });
  assert.equal(r.timedOut, true);
});

test('a workspace is the fixture, its config and one commit, and a failing setup stops it', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-prep-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const taskDir = path.join(tmp, 'task');
  fs.cpSync(path.join(REPO, 'tests', 'fixtures', 'ab', 'M02-doc-permissions'), taskDir, { recursive: true });
  const run = path.join(tmp, 'run1'); fs.mkdirSync(run);
  const { ws, before } = prepareWorkspace({ taskDir, tmp: run, globalConfig: { tiers: { main: 'medium' } } });
  assert.deepEqual(before.files.map(([p]) => p), [...fs.readdirSync(path.join(taskDir, 'fixture'), { recursive: true }).filter((p) => fs.statSync(path.join(taskDir, 'fixture', p)).isFile()), '.somi/config.json'].sort());
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ws, '.somi', 'config.json'), 'utf8')), { cost: { ceiling: 'medium' } });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(run, '.config', 'somi', 'config.json'), 'utf8')), { tiers: { main: 'medium' } });
  assert.equal(spawnSync('git', ['log', '--format=%s'], { cwd: ws, encoding: 'utf8' }).stdout.trim(), 'initial');
  const canary = JSON.parse(fs.readFileSync(path.join(taskDir, 'task.json'), 'utf8')).canary;
  fs.writeFileSync(path.join(taskDir, 'hidden', 'setup.mjs'), `// ${canary}\nprocess.exit(1);\n`);
  const run2 = path.join(tmp, 'run2'); fs.mkdirSync(run2);
  assert.throws(() => prepareWorkspace({ taskDir, tmp: run2 }), /the task setup failed/);
  fs.writeFileSync(path.join(taskDir, 'hidden', 'setup.mjs'), `// ${canary}\nimport fs from 'node:fs';\nfs.writeFileSync(process.argv[2] + '/made.txt', 'x');\n`);
  const run3 = path.join(tmp, 'run3'); fs.mkdirSync(run3);
  assert.ok(prepareWorkspace({ taskDir, tmp: run3 }).before.files.some(([p]) => p === 'made.txt'), 'what the setup makes is in the before snapshot');
  fs.rmSync(path.join(taskDir, 'hidden', 'setup.mjs'));
  fs.mkdirSync(path.join(taskDir, 'fixture', '.somi'));
  fs.writeFileSync(path.join(taskDir, 'fixture', '.somi', 'notes.md'), 'kept');
  const run5 = path.join(tmp, 'run5'); fs.mkdirSync(run5);
  const own = prepareWorkspace({ taskDir, tmp: run5 }).before.files.map(([p]) => p);
  assert.deepEqual(own.filter((p) => p.startsWith('.somi/')), ['.somi/config.json', '.somi/notes.md'], 'a fixture that has a .somi folder keeps it and gets the config');
  const run4 = path.join(tmp, 'run4'); fs.mkdirSync(run4);
  assert.throws(() => prepareWorkspace({ taskDir: path.join(tmp, 'nowhere'), tmp: run4 }), /the task directory could not be read/);
});
