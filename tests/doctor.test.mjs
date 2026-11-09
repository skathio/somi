import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, makeRepo, somi } from './helpers.mjs';
import { duplicateHookWarnings, runDoctor, sandboxSettings, settingsWarnings, tierWarnings } from '../scripts/lib/doctor.mjs';
import { copilotExtension, writeCopilotExtension } from '../scripts/lib/init.mjs';

const results = (touch, curl) => (cmd) => (cmd === 'touch' ? touch : curl);
test('a tier with no model is named, on the host that has no defaults', () => {
  assert.deepEqual(tierWarnings({}, 'claude'), []);
  assert.match(tierWarnings({}, 'copilot')[0], /low, medium, high on copilot/);
  assert.deepEqual(tierWarnings({ tiers: { copilot: { low: 'a', medium: 'b', high: 'c' } } }, 'copilot'), []);
});

const doctor = (exec, over = {}) => runDoctor({ root: '/nowhere', host: 'claude', platform: 'linux', home: '/nowhere-home', env: {}, exec, removeFile: () => {}, ...over });
const blocked = { status: 1 };
const allowed = { status: 0 };
const missing = { status: null, error: { code: 'ENOENT' } };

test('PASS only when both probes are blocked', () => {
  assert.equal(doctor(results(blocked, blocked)).verdict, 'PASS');
  assert.equal(doctor(results(allowed, blocked)).verdict, 'FAIL');
  assert.equal(doctor(results(blocked, allowed)).verdict, 'FAIL');
  assert.equal(doctor(results(allowed, allowed)).verdict, 'FAIL');
});

test('a probe that could not run is not a pass', () => {
  assert.equal(doctor(results(blocked, missing)).verdict, 'FAIL');
  assert.equal(doctor(results(missing, blocked)).verdict, 'FAIL');
});

test('a home-write probe that succeeded is cleaned up', () => {
  const removed = [];
  doctor(results(allowed, blocked), { removeFile: (p) => removed.push(p) });
  assert.equal(removed.length, 1);
  assert.match(removed[0], /\.somi-sandbox-probe-/);
});

test('native Windows fails with the WSL2 remedy and runs no probe', () => {
  const r = doctor(() => assert.fail('no probe on native Windows'), { platform: 'win32' });
  assert.equal(r.verdict, 'FAIL');
  assert.match(r.remedy, /WSL2/);
});

test('darwin uses the same probes', () => {
  assert.equal(doctor(results(blocked, blocked), { platform: 'darwin' }).verdict, 'PASS');
});

test('settings warn about strictness on each host', () => {
  assert.deepEqual(settingsWarnings('claude', { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false }), []);
  assert.equal(settingsWarnings('claude', { enabled: true }).length, 2);
  assert.match(settingsWarnings('claude', null)[0], /not enabled/);
  assert.ok(settingsWarnings('copilot', { enabled: true }).some((w) => /public preview/.test(w)));
});

test('project settings merge over user settings on Claude Code', (t) => {
  const dir = makeRepo(t);
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/settings.json'), JSON.stringify({ sandbox: { enabled: true } }));
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude/settings.json'), JSON.stringify({ sandbox: { failIfUnavailable: true } }));
  assert.deepEqual(sandboxSettings({ host: 'claude', root: dir, home, env: {} }), { enabled: true, failIfUnavailable: true });
});

test('Copilot CLI runs the plugin\'s own hooks, so init writes none, and an old copy is reported as running every hook twice', (t) => {
  const dir = makeRepo(t);
  assert.equal(somi(dir, ['init', '--host', 'copilot']).status, 0);
  assert.equal(fs.existsSync(path.join(dir, '.github', 'hooks', 'somi.json')), false);
  assert.deepEqual(duplicateHookWarnings(dir), []);
  fs.mkdirSync(path.join(dir, '.github', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'hooks', 'somi.json'), '{}');
  assert.match(duplicateHookWarnings(dir)[0], /earlier somi init[\s\S]*every SoMi hook runs twice; delete that file/);
  assert.match(JSON.parse(somi(dir, ['init', '--host', 'copilot']).stdout).warning, /runs twice/, 'init says so too');
});

test('init writes a Copilot extension that loads SoMi\'s workflow module from the plugin, and never overwrites another', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-ext-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = writeCopilotExtension(dir, REPO);
  assert.equal(first.written, true);
  assert.equal(first.file, path.join(dir, '.github', 'extensions', 'somi', 'extension.mjs'));
  assert.equal(writeCopilotExtension(dir, REPO).written, true, 'the same file again is fine');
  assert.equal(writeCopilotExtension(dir, '/elsewhere').written, false, 'a different file is not overwritten');
  const url = /await import\(("[^"]+")\)/.exec(copilotExtension(REPO))[1];
  const lib = await import(JSON.parse(url));
  assert.equal(typeof lib.registerCopilotWorkflows, 'function', 'the module it points at exists and exports the entry');
  assert.match(copilotExtension(REPO), /from '@github\/copilot-sdk\/extension'/);
});
