import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, makeRepo, somi } from './helpers.mjs';
import { duplicateHookWarnings, runDoctor, sandboxSettings, settingsWarnings, tierWarnings } from '../scripts/lib/doctor.mjs';
import { copilotExtension } from '../scripts/lib/init.mjs';

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
  const env = { COPILOT_HOME: path.join(dir, '.git', 'copilot-home') };
  const init = somi(dir, ['init', '--host', 'copilot'], { env });
  assert.equal(init.status, 0, init.stderr);
  assert.equal(init.json.extension.file, path.join(env.COPILOT_HOME, 'extensions', 'somi', 'extension.mjs'), 'once for every project, in the user\'s folder');
  assert.equal(fs.existsSync(path.join(dir, '.github')), false, 'nothing is written into the project');
  assert.equal(somi(dir, ['init', '--host', 'copilot'], { env }).status, 0, 'again is fine');
  assert.deepEqual(duplicateHookWarnings(dir), []);
  fs.mkdirSync(path.join(dir, '.github', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'hooks', 'somi.json'), '{}');
  assert.match(duplicateHookWarnings(dir)[0], /earlier somi init[\s\S]*every SoMi hook runs twice; delete that file/);
  assert.match(somi(dir, ['init', '--host', 'copilot'], { env }).json.warnings[0], /runs twice/, 'init says so too');
});

test('a bare init works: it finds Copilot by its folder or environment, and on Claude Code it says nothing is needed', (t) => {
  const dir = makeRepo(t);
  const home = path.join(dir, '.git', 'home');
  fs.mkdirSync(path.join(home, '.copilot'), { recursive: true });
  const copilot = somi(dir, ['init'], { env: { HOME: home, USERPROFILE: home, SOMI_HOST: '' } });
  assert.equal(copilot.status, 0, copilot.stderr);
  assert.equal(fs.existsSync(path.join(home, '.copilot', 'extensions', 'somi', 'extension.mjs')), true);
  assert.match(copilot.json.workflows, /reload/i, 'a file that is current is not a loaded extension; the reload is named');
  const named = somi(dir, ['init'], { env: { HOME: home, USERPROFILE: home, SOMI_HOST: 'claude' } });
  assert.equal(named.json.host, 'claude', 'a named host wins over the folder');
  assert.equal(somi(dir, ['init', '--host', 'claude'], { env: { HOME: home, USERPROFILE: home, SOMI_HOST: '' } }).json.host, 'claude');
  assert.equal(somi(dir, ['init', '--host', 'nope'], { env: { SOMI_HOST: '' } }).status, 64);
  const bare = path.join(dir, '.git', 'bare-home');
  fs.mkdirSync(bare);
  const claude = somi(dir, ['init'], { env: { HOME: bare, USERPROFILE: bare, SOMI_HOST: '' } });
  assert.equal(claude.status, 0, claude.stderr);
  assert.match(claude.json.host, /claude/);
  assert.equal(fs.existsSync(path.join(bare, '.copilot')), false, 'nothing is written for Claude Code');
});

test('the extension points at a module that exists and exports the entry', async () => {
  const url = /new URL\(("[^"]+")\)/.exec(copilotExtension(REPO))[1];
  const lib = await import(JSON.parse(url));
  assert.equal(typeof lib.registerCopilotWorkflows, 'function');
  assert.match(copilotExtension(REPO), /from '@github\/copilot-sdk\/extension'/);
});
