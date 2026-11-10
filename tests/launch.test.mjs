import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findOnWindowsPath, launchPlan, spawnPlan } from '../scripts/lib/launch.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('launch starts each host with SoMi\'s agent on the model set for the conversation\'s tier', () => {
  assert.deepEqual(launchPlan({ host: 'claude' }).args, ['--agent', 'somi:somi', '--model', 'sonnet'], 'medium, on the built-in Claude Code model');
  const config = { tiers: { copilot: { low: 'cheap', medium: 'everyday', high: 'strong' } } };
  assert.deepEqual(launchPlan({ host: 'copilot', config }).args, ['--agent', 'somi:somi', '--model', 'everyday', '--experimental'], 'Copilot runs /somi-deliver only in experimental mode');
  assert.equal(launchPlan({ host: 'copilot', config: { tiers: { ...config.tiers, main: 'high' } } }).model, 'strong', 'tiers.main moves it');
  assert.equal(launchPlan({ host: 'copilot', config: { tiers: { ...config.tiers, main: 'high', ceiling: 'low' } } }).model, 'cheap', 'a ceiling caps it');
});

test('what the user passes comes last, and a flag they set is not added again', () => {
  assert.deepEqual(launchPlan({ host: 'claude', extra: ['--model', 'opus', '-c'] }).args, ['--agent', 'somi:somi', '--model', 'opus', '-c']);
  assert.deepEqual(launchPlan({ host: 'claude', extra: ['--agent=other'] }).args, ['--model', 'sonnet', '--agent=other']);
  assert.deepEqual(launchPlan({ host: 'copilot', extra: ['--no-experimental'] }).args, ['--agent', 'somi:somi', '--no-experimental']);
});

test('with no model for the tier, the host starts on its own default and the user is told where to set one', () => {
  const plan = launchPlan({ host: 'copilot' });
  assert.equal(plan.model, null);
  assert.ok(!plan.args.includes('--model'));
  assert.match(plan.warnings[0], /set tiers\.copilot\.medium in SoMi's global config/);
});

test('on Windows the host is found by PATH and PATHEXT, a native .exe starts directly, and an npm .cmd shim goes through cmd.exe', () => {
  const files = new Set(['c:\\bin\\claude.exe', 'c:\\users\\u\\appdata\\roaming\\npm\\copilot.cmd']);
  const env = { PATH: 'C:\\nothing;C:\\bin;C:\\Users\\u\\AppData\\Roaming\\npm', PATHEXT: '.COM;.EXE;.CMD', ComSpec: 'C:\\Windows\\system32\\cmd.exe' };
  const shimText = '@ECHO off\r\n"%_prog%" "%dp0%\\node_modules\\@github\\copilot\\npm-loader.js" %*\r\n';
  const on = { platform: 'win32', env, exists: (f) => files.has(f.toLowerCase()), read: () => shimText }; // Windows file names ignore case
  assert.equal(findOnWindowsPath('nope', env, on.exists), null);
  assert.equal(spawnPlan('nope', [], on), null);
  assert.deepEqual(spawnPlan('claude', ['--agent', 'somi:somi'], on), { file: 'C:\\bin\\claude.EXE', args: ['--agent', 'somi:somi'], options: {} });
  const shim = spawnPlan('copilot', ['-p', 'x y'], on);
  assert.equal(shim.file, 'C:\\Windows\\system32\\cmd.exe');
  assert.deepEqual(shim.options, { windowsVerbatimArguments: true });
  assert.deepEqual(shim.args, ['/d', '/s', '/c', '"C:\\Users\\u\\AppData\\Roaming\\npm\\copilot.CMD ^^^"-p^^^" ^^^"x^^^ y^^^""'], 'quoted, then escaped twice, because the shim hands its arguments to cmd.exe again');
  assert.deepEqual(spawnPlan('claude', ['a'], { platform: 'linux', env: {} }), { file: 'claude', args: ['a'], options: {} }, 'elsewhere no shell is involved');
});

test('a .cmd file is escaped twice when it forwards its arguments, wherever it is installed, and when it cannot be read', () => {
  const env = { PATH: 'C:\\nvm4w\\nodejs', PATHEXT: '.CMD' };
  const line = (read) => spawnPlan('claude', ['say "hi & calc'], { platform: 'win32', env, exists: () => true, read }).args[3];
  const twice = line(() => '@"%~dp0\\node.exe" "%~dp0\\cli.js" %*');
  assert.equal(twice, '"C:\\nvm4w\\nodejs\\claude.CMD ^^^"say^^^ \\^^^"hi^^^ ^^^&^^^ calc^^^""', 'nvm-windows keeps its shims outside any npm folder');
  assert.equal(line(() => { throw new Error('EACCES'); }), twice, 'unreadable fails closed');
  assert.equal(line(() => '@echo hello'), '"C:\\nvm4w\\nodejs\\claude.CMD ^"say^ \\^"hi^ ^&^ calc^""', 'a batch file that forwards nothing is read by cmd.exe once');
});

test('launch refuses a host it does not know', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'somi.mjs'), 'launch', 'vim'], { encoding: 'utf8', env: { ...process.env, SOMI_GLOBAL_CONFIG: '' } });
  assert.equal(r.status, 64);
  assert.match(r.stderr, /launch takes claude or copilot/);
});
