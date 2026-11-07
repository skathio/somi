// The draw's stream and disk hygiene. The agent runs with the eval token in its environment and the hidden material nearby, so every
// line it prints and every file it leaves is scanned: a leak is named, the token never reaches disk unredacted, transcripts are
// deleted after a scan, and no process of the draw outlives it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { writeFiles } from './helpers.mjs';
import { createSink, inspectDraw, redactToken, sweepProcesses, tokenHit } from './evals/lib/ab-stream.mjs';

const TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CANARY = 'SOMI-CANARY-STREAM-0123456789';
const TASK = 'tests/fixtures/ab/T1';

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-stream-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function sink(t, opts = {}) {
  const file = path.join(scratch(t), 'stream.jsonl');
  const s = createSink(file, { token: TOKEN, canary: CANARY, task: TASK, absAb: '/repo/tests/fixtures/ab', ownTmp: '/tmp/ab-draw-own', ...opts });
  const lines = (...events) => { s.feed(Buffer.from(events.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n')); };
  return { s, lines, written: () => fs.readFileSync(file, 'utf8') };
}
const assistant = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

test('every 12-character window of the token is redacted, merged, and an sk-ant- key too', () => {
  assert.equal(redactToken(`a ${TOKEN} b`, TOKEN), 'a [REDACTED] b');
  assert.equal(redactToken(`x${TOKEN.slice(5, 17)}y ${TOKEN.slice(20, 31)}`, TOKEN), `x[REDACTED]y ${TOKEN.slice(20, 31)}`, 'a fragment shorter than 12 stays');
  assert.equal(redactToken(`${TOKEN.slice(0, 20)}\n${TOKEN.slice(20)}`, TOKEN), '[REDACTED]\n[REDACTED]');
  assert.equal(redactToken('key sk-ant-api03-abcd and sk-ant-x', TOKEN), 'key [REDACTED] and sk-ant-x');
  assert.equal(tokenHit('nothing here', TOKEN), false);
  assert.equal(redactToken('same', ''), 'same');
});

test('the token, the canary and an sk-ant- prefix are leaks in any line, and the line reaches disk redacted', (t) => {
  const { s, lines, written } = sink(t);
  lines({ type: 'system', note: TOKEN }, { type: 'system', note: CANARY }, { type: 'system', note: 'sk-ant-' });
  s.end();
  assert.deepEqual([...s.state.leaks].sort(), ['canary', 'sk-ant-', 'token']);
  assert.equal(written().includes(TOKEN), false);
  assert.match(written(), /\[REDACTED\]/);
});

test('paths are leaks only in what the agent did and saw, and its own directory is not another draw', (t) => {
  const quiet = sink(t);
  quiet.lines({ type: 'system', files: ['tests/fixtures/ab', `${TASK}/hidden`, '/tmp/ab-draw-other'] });
  assert.deepEqual([...quiet.s.state.leaks], [], 'a system event lists the plugin files');
  const seen = sink(t);
  seen.lines(assistant('reading tests/fixtures/ab'), { type: 'user', text: `${TASK}/oracle/x` }, assistant(`${TASK}/hidden/a`), assistant('cat .somi/eval.env'), assistant('/repo/tests/fixtures/ab/x'));
  assert.deepEqual([...seen.s.state.leaks].sort(), ['ab-path', 'eval-env', 'task-hidden', 'task-oracle']);
  const own = sink(t);
  own.lines(assistant('/tmp/ab-draw-own/ws and Did you mean ./ab-draw-own/x'), 'not json /tmp/ab-draw-own');
  assert.deepEqual([...own.s.state.leaks], []);
  const other = sink(t);
  other.lines('plain text /tmp/ab-draw-elsewhere/x');
  assert.deepEqual([...other.s.state.leaks], ['other-draw'], 'a line that is not JSON is scanned like an agent line');
});

test('results add up turns, keep the last text, and a usage limit is read from text or a rate-limit event', (t) => {
  const { s, lines } = sink(t);
  lines(assistant('first'), { type: 'result', num_turns: 2, result: 'done' }, assistant('second'), { type: 'result', num_turns: 3, subtype: 'success' }, { type: 'result', num_turns: -1 });
  assert.deepEqual({ turns: s.state.turns, text: s.state.text, limit: s.state.limit, subtype: s.state.result.subtype }, { turns: 5, text: 'second', limit: false, subtype: undefined });
  s.turn();
  assert.deepEqual({ turns: s.state.turns, text: s.state.text, result: s.state.result }, { turns: 0, text: '', result: null });
  lines({ type: 'result', result: "You've hit your weekly limit · resets Sunday 1pm" });
  assert.deepEqual({ limit: s.state.limit, reset: s.state.reset }, { limit: true, reset: 'Sunday 1pm' });
  const rejected = sink(t);
  rejected.lines({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } });
  assert.equal(rejected.s.state.limit, true);
  const allowed = sink(t);
  allowed.lines({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }, assistant('usage limit reached'));
  assert.deepEqual({ limit: allowed.s.state.limit, reset: allowed.s.state.reset }, { limit: true, reset: null });
});

test('a line split across reads and an unterminated last line are each read whole, once', (t) => {
  const file = path.join(scratch(t), 'stream.jsonl');
  const s = createSink(file, { token: TOKEN, canary: CANARY, task: TASK });
  const line = Buffer.from(`${JSON.stringify(assistant('héllo'))}\n`);
  const cut = line.indexOf(Buffer.from('é')) + 1;
  s.feed(line.subarray(0, cut)); s.feed(line.subarray(cut));
  s.feed(Buffer.from(JSON.stringify(assistant('tail'))));
  assert.equal(s.state.text, 'héllo');
  s.turn();
  s.feed(Buffer.from(`${JSON.stringify(assistant('next'))}\n`));
  s.end();
  assert.deepEqual(fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l).message.content[0].text), ['héllo', 'tail', 'next']);
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
});

test('the last line of a stream is written at the end even without a newline', (t) => {
  const file = path.join(scratch(t), 'stream.jsonl');
  const s = createSink(file, { token: TOKEN, canary: CANARY, task: TASK });
  s.feed(Buffer.from(JSON.stringify(assistant(`last ${TOKEN}`))));
  s.end();
  assert.deepEqual({ text: s.state.text, leaks: [...s.state.leaks] }, { text: `last ${TOKEN}`, leaks: ['token'] });
  assert.equal(fs.readFileSync(file, 'utf8'), `${JSON.stringify(assistant('last [REDACTED]'))}\n`);
});

test('a line longer than 16 MiB caps the sink', (t) => {
  const { s } = sink(t);
  s.feed(Buffer.alloc(16 * 1024 * 1024 + 1, 0x61));
  assert.equal(s.state.capped, true);
});

test('output over the cap stops the sink, and nothing after it is written', (t) => {
  const file = path.join(scratch(t), 'stream.jsonl');
  const s = createSink(file, { token: TOKEN, canary: CANARY, task: TASK, maxBytes: 64 });
  s.feed(Buffer.from(`${JSON.stringify({ a: 1 })}\n`));
  s.feed(Buffer.from(`${JSON.stringify({ b: 'x'.repeat(80) })}\n${CANARY}\n`));
  s.end();
  assert.deepEqual({ capped: s.state.capped, bytes: s.state.bytes, leaks: [...s.state.leaks] }, { capped: true, bytes: 127, leaks: [] });
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}\n');
});

function draw(t, { files = {}, cfgFiles = {} } = {}) {
  const dir = scratch(t);
  const ws = path.join(dir, 'ws'); const cfg = path.join(dir, 'cfg'); const drawDir = path.join(dir, 'draw');
  for (const d of [ws, cfg, drawDir]) fs.mkdirSync(d);
  writeFiles(ws, files); writeFiles(cfg, cfgFiles);
  const after = { ok: true, files: Object.keys(files).map((p) => [p, '0'.repeat(64)]) };
  return { ws, cfg, drawDir, after, inspect: (over = {}) => inspectDraw({ ws, cfg, after, drawDir, token: TOKEN, canary: CANARY, absAb: '/repo/tests/fixtures/ab', ...over }) };
}

test('a clean draw has no leaks, and an unscanned workspace is one', (t) => {
  const d = draw(t, { files: { 'src/a.js': 'ok' } });
  assert.deepEqual(d.inspect(), []);
  assert.deepEqual(d.inspect({ after: { ok: false } }), ['unscanned-workspace']);
  assert.deepEqual(d.inspect({ after: { ok: true, files: [['gone.js', '0'.repeat(64)]] } }), ['unscanned-workspace']);
  const deep = draw(t);
  fs.mkdirSync(path.join(deep.ws, ...Array.from({ length: 34 }, (_, i) => `d${i}`)), { recursive: true });
  assert.deepEqual(deep.inspect(), ['unscanned-workspace'], 'a tree too deep to walk is not called clean');
});

test('a walk over 100000 entries is not called clean', (t) => {
  const d = draw(t);
  for (let i = 0; i <= 100000; i++) fs.writeFileSync(path.join(d.ws, `f${i}`), '');
  assert.deepEqual(d.inspect(), ['unscanned-workspace']);
});

test('a file over 64 MiB is not read, so a transcript that large is unscanned', (t) => {
  const d = draw(t, { cfgFiles: { 'projects/p/1.jsonl': '' } });
  fs.truncateSync(path.join(d.cfg, 'projects', 'p', '1.jsonl'), 64 * 1024 * 1024 + 1);
  assert.deepEqual(d.inspect(), ['unscanned-transcript']);
});

test('every file the inspection opens is closed again', (t) => {
  const d = draw(t, { files: { 'src/a.js': 'ok' }, cfgFiles: { 'projects/p/1.jsonl': '{}\n', 'x.json': '{}' } });
  const open = new Set();
  const realOpen = fs.openSync; const realClose = fs.closeSync;
  t.mock.method(fs, 'openSync', (...a) => { const fd = realOpen(...a); open.add(fd); return fd; });
  t.mock.method(fs, 'closeSync', (fd) => { open.delete(fd); realClose(fd); });
  assert.deepEqual(d.inspect(), []);
  assert.equal(open.size, 0);
});

test('the canary in a workspace file is a silent copy of the oracle', (t) => {
  assert.deepEqual(draw(t, { files: { 'src/a.js': `// ${CANARY}` } }).inspect(), ['canary-in-file']);
});

test('transcripts are scanned, kept redacted when small, and then deleted', (t) => {
  const d = draw(t, { cfgFiles: { 'projects/p/1.jsonl': `{"a":"${CANARY}"}\n`, 'projects/p/2.jsonl': `{"b":"${TOKEN} /repo/tests/fixtures/ab/x"}\n`, 'projects/p/notes.txt': CANARY, 'projects/p/big.jsonl': 'x'.repeat(2 * 1024 * 1024 + 1) } });
  assert.deepEqual(d.inspect(), ['ab-path-in-transcript', 'canary-in-transcript', 'token']);
  assert.equal(fs.existsSync(path.join(d.cfg, 'projects')), false);
  const kept = fs.readdirSync(path.join(d.drawDir, 'transcripts')).sort();
  assert.deepEqual(kept, ['1.jsonl', '2.jsonl'], 'a transcript over 2 MiB is not kept');
  const texts = kept.map((f) => fs.readFileSync(path.join(d.drawDir, 'transcripts', f), 'utf8')).join('');
  assert.equal(texts.includes(TOKEN), false);
  assert.equal(texts.includes(CANARY), true);
  assert.equal((fs.statSync(path.join(d.drawDir, 'transcripts', '1.jsonl')).mode & 0o777).toString(8), '600');
});

test('an unreadable transcript is a leak of its own, and a projects file that is not a directory is removed', (t) => {
  const d = draw(t, { cfgFiles: { 'projects/p/1.jsonl': '{}\n' } });
  fs.chmodSync(path.join(d.cfg, 'projects', 'p', '1.jsonl'), 0o000);
  assert.deepEqual(d.inspect(), ['unscanned-transcript']);
  assert.deepEqual(draw(t, { cfgFiles: { 'projects/p/1.jsonl': '{"ok":1}\n' } }).inspect(), [], 'a clean transcript is no leak');
  const f = draw(t, { cfgFiles: { projects: 'a file' } });
  assert.deepEqual(f.inspect(), []);
  assert.equal(fs.existsSync(path.join(f.cfg, 'projects')), false);
});

test('the token is redacted in place in every workspace and config file, and a link is never followed', (t) => {
  const d = draw(t, { files: { 'src/a.js': `const t = '${TOKEN}';` }, cfgFiles: { 'settings.json': `{"k":"${TOKEN}"}` } });
  const outside = path.join(scratch(t), 'outside.txt');
  fs.writeFileSync(outside, TOKEN);
  fs.symlinkSync(outside, path.join(d.cfg, 'link.txt'));
  assert.deepEqual(d.inspect(), ['token']);
  assert.equal(fs.readFileSync(path.join(d.ws, 'src', 'a.js'), 'utf8'), "const t = '[REDACTED]';");
  assert.equal(fs.readFileSync(path.join(d.cfg, 'settings.json'), 'utf8'), '{"k":"[REDACTED]"}');
  assert.equal(fs.readFileSync(outside, 'utf8'), TOKEN, 'the link target is untouched');
});

const alive = (pid) => { try { return !/^State:\s+Z/m.test(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); } catch { return false; } };
async function ends(pid, ms = 3000) {
  for (const until = Date.now() + ms; Date.now() < until; await new Promise((res) => setTimeout(res, 50))) if (!alive(pid)) return true;
  return !alive(pid);
}

test('the sweep kills every process holding the draw\'s config entry, even one in its own session, and no other', async (t) => {
  const entry = `CLAUDE_CONFIG_DIR=${scratch(t)}/cfg`;
  const start = (env) => { const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { env, detached: true, stdio: 'ignore' }); c.unref(); return c.pid; };
  const mine = start({ PATH: process.env.PATH, CLAUDE_CONFIG_DIR: entry.split('=')[1] });
  const other = start({ PATH: process.env.PATH, CLAUDE_CONFIG_DIR: `${entry.split('=')[1]}-other` });
  t.after(() => { for (const pid of [mine, other]) if (alive(pid)) process.kill(pid, 'SIGKILL'); });
  await new Promise((res) => setTimeout(res, 200));
  await sweepProcesses(entry);
  assert.equal(await ends(mine), true);
  assert.equal(alive(other), true, 'a prefix of the entry is not a match');
});

test('a file that vanishes during the walk is skipped, and the rest are still redacted', (t) => {
  const d = draw(t, { files: { 'a.txt': 'gone soon', 'b.txt': TOKEN } });
  const real = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (p, ...a) => { if (p.endsWith('a.txt')) throw Object.assign(new Error('gone'), { code: 'ENOENT' }); return real(p, ...a); });
  assert.deepEqual(d.inspect({ after: { ok: true, files: [] } }), ['token']);
  assert.equal(fs.readFileSync(path.join(d.ws, 'b.txt'), 'utf8'), '[REDACTED]');
});

test('a sweep with nothing to kill returns at once', async (t) => {
  const started = Date.now();
  await sweepProcesses(`CLAUDE_CONFIG_DIR=${scratch(t)}/none`);
  assert.ok(Date.now() - started < 1000, 'a process it did not kill, or could not read, is not counted');
});
