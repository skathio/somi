import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copilotExtension, copilotExtensionFile, copilotWorkflowsOn, installCopilotExtension, isInside, projectExtensionWarnings } from '../scripts/lib/init.mjs';
import { copilotWorkflowWarnings, runDoctor } from '../scripts/lib/doctor.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-ext-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

// Copilot resolves the SDK for an extension itself, so the test stands in a stub that prints what the extension registered.
function runExtension(dir, text) {
  const sdk = path.join(dir, 'sdk.mjs');
  fs.writeFileSync(sdk, "export const defineWorkflow = (w) => w;\nexport const joinSession = async (o) => { console.log(JSON.stringify((o.workflows ?? []).map((w) => w.meta.name))); };\n");
  const file = path.join(dir, 'extension.mjs');
  fs.writeFileSync(file, text.replace("'@github/copilot-sdk/extension'", JSON.stringify(pathToFileURL(sdk).href)));
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('the extension registers the staged workflow under the name somi_route gives, and loads quietly once the plugin is gone', (t) => {
  const dir = tmp(t);
  assert.deepEqual(runExtension(dir, copilotExtension(REPO)), ['somi-deliver-stages']);
  assert.deepEqual(runExtension(dir, copilotExtension(path.join(dir, 'uninstalled'))), [], 'it joins with nothing instead of failing to load');
});

test('it is written once for every project in the user\'s Copilot folder, and kept pointing at the installed plugin', (t) => {
  const home = tmp(t);
  const file = copilotExtensionFile({}, home);
  assert.equal(file, path.join(home, '.copilot', 'extensions', 'somi', 'extension.mjs'));
  assert.equal(copilotExtensionFile({ COPILOT_HOME: path.join(home, 'c') }, home), path.join(home, 'c', 'extensions', 'somi', 'extension.mjs'));
  assert.deepEqual(installCopilotExtension({ pluginRoot: '/p/1.0.0', env: {}, home }), { written: true, file });
  assert.deepEqual(installCopilotExtension({ pluginRoot: '/p/1.0.0', env: {}, home }), { written: false, current: true, file }, 'an unchanged file is not rewritten');
  assert.equal(installCopilotExtension({ pluginRoot: '/p/2.0.0', env: {}, home }).written, true, 'an update moves it to the new plugin folder');
  assert.match(fs.readFileSync(file, 'utf8'), /\/p\/2\.0\.0\/scripts\/lib\/copilot-workflow\.mjs/);
});

test('a file SoMi did not write, or a link, is left alone', { skip: process.platform === 'win32' && 'a symlink needs extra rights on Windows' }, (t) => {
  const home = tmp(t);
  const file = copilotExtensionFile({}, home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '// mine\n');
  assert.match(installCopilotExtension({ pluginRoot: REPO, env: {}, home }).reason, /different extension\.mjs/);
  assert.equal(fs.readFileSync(file, 'utf8'), '// mine\n');
  fs.rmSync(file);
  const elsewhere = path.join(home, 'elsewhere.mjs');
  fs.writeFileSync(elsewhere, '');
  fs.symlinkSync(elsewhere, file);
  assert.match(installCopilotExtension({ pluginRoot: REPO, env: {}, home }).reason, /link/);
  assert.equal(fs.readFileSync(elsewhere, 'utf8'), '');
});

test('only the global config turns it off, so a project cannot hide that it is missing', (t) => {
  assert.equal(copilotWorkflowsOn(null), true);
  assert.equal(copilotWorkflowsOn({ copilot: {} }), true);
  assert.equal(copilotWorkflowsOn({ copilot: { workflows: false } }), false);
  const home = tmp(t);
  const doctor = (over) => runDoctor({ root: home, host: 'copilot', platform: 'linux', home, env: {}, exec: () => ({ status: 1 }), removeFile: () => {}, ...over }).warnings.some((w) => /is missing/.test(w));
  assert.equal(doctor({ config: { copilot: { workflows: false } } }), true, 'the merged config, which a project can set, does not count');
  assert.equal(doctor({ globalConfig: { copilot: { workflows: false } } }), false);
});

test('a copy inside the project is told apart from one beside it, whatever its folder is called', () => {
  assert.equal(isInside('/p', '/p'), true);
  assert.equal(isInside('/p', '/p/vendor/somi'), true);
  assert.equal(isInside('/p', '/p/..vendor/somi'), true);
  assert.equal(isInside('/p', '/q/somi'), false);
  assert.equal(isInside('/p', '/'), false);
});

test('the doctor says when the workflow is not registered, and when an earlier init registers it twice', (t) => {
  const home = tmp(t);
  const root = tmp(t);
  assert.deepEqual(copilotWorkflowWarnings('claude', root, { home, env: {} }), []);
  assert.match(copilotWorkflowWarnings('copilot', root, { home, env: {} })[0], /is missing, so \/somi-deliver has no workflow to run/);
  assert.deepEqual(copilotWorkflowWarnings('copilot', root, { config: { copilot: { workflows: false } }, home, env: {} }), [], 'turned off, its absence is not a problem');
  installCopilotExtension({ pluginRoot: REPO, env: {}, home });
  assert.deepEqual(copilotWorkflowWarnings('copilot', root, { home, env: {} }), []);
  const old = path.join(root, '.github', 'extensions', 'somi', 'extension.mjs');
  fs.mkdirSync(path.dirname(old), { recursive: true });
  fs.writeFileSync(old, "// Written by somi init: registers SoMi's staged workflows with Copilot CLI.\n");
  assert.match(projectExtensionWarnings(root)[0], /registered twice here; delete that folder/);
  assert.equal(copilotWorkflowWarnings('copilot', root, { home, env: {} }).length, 1);
});

test('session start on Copilot registers it and says so once, and leaves it be when turned off or on Claude Code', (t) => {
  const home = tmp(t);
  const run = (host, config, project = home) => {
    const configFile = path.join(home, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify(config ?? {}));
    const r = spawnSync(process.execPath, [path.join(REPO, 'hooks', 'session-start', 'inject-digest.mjs')], {
      input: '{}', encoding: 'utf8', cwd: home,
      env: { PATH: process.env.PATH, HOME: home, SOMI_GLOBAL_CONFIG: configFile, CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_ROOT: REPO, SOMI_HOST: host, SOMI_NO_UPDATE_CHECK: '1' },
    });
    return JSON.parse(r.stdout).additionalContext;
  };
  const file = copilotExtensionFile({}, home);
  run('claude');
  assert.equal(fs.existsSync(file), false, 'Claude Code reads workflows from the plugin');
  run('copilot', { copilot: { workflows: false } });
  assert.equal(fs.existsSync(file), false);
  run('copilot', {}, REPO);
  assert.equal(fs.existsSync(file), false, 'a copy inside the project, such as a vendored one, does not become every project\'s');
  assert.match(run('copilot'), /just registered its staged workflow[\s\S]*after \/clear/);
  assert.equal(fs.existsSync(file), true);
  assert.doesNotMatch(run('copilot'), /just registered/, 'said only when it was written');
});
