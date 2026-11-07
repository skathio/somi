// The draw driver's two judgements a run rests on: the eval token is read only from an owner-only file holding exactly one line,
// and each draw gets one outcome, decided by the first rule that matches, so a leak or an infrastructure failure is never scored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classify, readEnvFile } from './evals/lib/ab-draw.mjs';

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
