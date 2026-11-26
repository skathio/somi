// Rules the request implies that the other suites do not hold: a failed overview page build
// leaves no site/dist behind, as a failed docs build does, and `{{ }}` in an indented code
// block renders as text, as it does in prose and inline code. The link helpers also answer a
// value that is not a string the way rewriteLink and h1Label do, without throwing.
//
// Each build case runs build.sh from the root of a copy of the working tree, so the real repo is
// never written. Those need the installed toolchains, and skip with a reason without them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeBraces, githubSlug } from './links.mjs';

const docsSite = dirname(fileURLToPath(import.meta.url));
const root = join(docsSite, '..');
const MODULES = ['docs-site/node_modules', 'site/node_modules'];
const installed = MODULES.every((m) => existsSync(join(root, m)));
const needsBuild = { skip: !installed && 'needs `npm ci --ignore-scripts` in site/ and docs-site/' };
const PROBE = 'zz-indented-code.md';

function copyWorkingTree() {
  const listed = spawnSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  const tmp = mkdtempSync(join(tmpdir(), 'somi-docs-gaps-'));
  const files = listed.stdout.split('\0').filter((f) => f && !f.split('/').includes('node_modules'));
  for (const f of files.filter((x) => existsSync(join(root, x)) && lstatSync(join(root, x)).isFile())) {
    mkdirSync(dirname(join(tmp, f)), { recursive: true });
    cpSync(join(root, f), join(tmp, f));
  }
  for (const m of MODULES) { symlinkSync(join(root, m), join(tmp, m)); }
  return tmp;
}

function runBuild(cwd) {
  return new Promise((done) => {
    const child = spawn('bash', ['docs-site/build.sh'], { cwd });
    const out = { stdout: '', stderr: '' };
    child.stdout.on('data', (d) => { out.stdout += d; });
    child.stderr.on('data', (d) => { out.stderr += d; });
    child.on('close', (status) => done({ ...out, status }));
  });
}

const SCENARIOS = {
  // The overview page is written by Vite, then its own check-dist refuses it.
  siteCheckFails: (tmp) => writeFileSync(join(tmp, 'site', 'scripts', 'check-dist.mjs'), 'process.exit(1);\n'),
  indentedCode: (tmp) => writeFileSync(join(tmp, 'docs', PROBE), '# Indented code\n\nBefore.\n\n    sum {{ 7 + 7 }} end\n\nAfter.\n'),
};
const state = {};

before(async () => {
  if (!installed) { return; }
  const names = Object.keys(SCENARIOS);
  for (const name of names) {
    state[name] = { dir: copyWorkingTree() };
    SCENARIOS[name](state[name].dir);
  }
  const runs = await Promise.all(names.map((n) => runBuild(state[n].dir)));
  names.forEach((n, i) => { state[n].run = runs[i]; });
});

after(() => { for (const s of Object.values(state)) { rmSync(s.dir, { recursive: true, force: true }); } });

test('a failed overview page build exits non-zero and leaves no site/dist behind', needsBuild, () => {
  const { dir, run } = state.siteCheckFails;
  assert.notEqual(run.status, 0, `build.sh exited 0:\n${run.stdout}`);
  assert.equal(existsSync(join(dir, 'site', 'dist')), false, 'site/dist is left with an overview page that failed its own check');
});

test('a failed overview page build says so in one line on stderr', needsBuild, () => {
  const lines = state.siteCheckFails.run.stderr.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `stderr is not one line:\n${state.siteCheckFails.run.stderr}`);
  assert.match(lines[0], /overview page/);
  assert.doesNotMatch(lines[0], /No such file|command not found|line \d+:/, 'a shell error, not a message from build.sh');
});

test('{{ }} in an indented code block renders as text, never as a Vue expression', needsBuild, () => {
  const { dir, run } = state.indentedCode;
  assert.equal(run.status, 0, `docs-site/build.sh failed:\n${run.stdout}\n${run.stderr}`);
  const html = readFileSync(join(dir, 'site', 'dist', 'docs', PROBE.replace(/\.md$/, '.html')), 'utf8');
  assert.match(html, /sum \{\{ 7 \+ 7 \}\} end/, 'the braces are not shown as written');
  assert.doesNotMatch(html, /sum 14 end/, 'the braces ran as a Vue expression');
});

const NOT_STRINGS = [undefined, null, 7, {}, ['a b']];

test('githubSlug gives an empty id for a heading that is not a string', () => {
  for (const value of NOT_STRINGS) { assert.equal(githubSlug(value), ''); }
  assert.equal(githubSlug(), '');
  assert.equal(githubSlug(''), '');
});

test('escapeBraces gives empty text for a value that is not a string', () => {
  for (const value of NOT_STRINGS) { assert.equal(escapeBraces(value), ''); }
  assert.equal(escapeBraces(), '');
  assert.equal(escapeBraces(''), '');
});
