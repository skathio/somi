// What reaches Pages has passed the page's own tests and carries the kit its header loads: the page-only
// deploy and the release run `npm --prefix site test` before the build, and ci.yml and the release copy
// hashira's site kit into site/dist and run check-dist in its strict mode, where the kit files must exist
// like any other asset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from './helpers.mjs';
import { checkBuiltHtml } from '../site/scripts/check-dist.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const code = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const CHECK = path.join(REPO, 'site/scripts/check-dist.mjs');

// A job's body: the lines after `  <name>:` up to the next two-space-indented key.
const job = (rel, name) => {
  const m = new RegExp(`^ {2}${name}:\\s*\\n((?:(?! {2}\\S).*\\n?)*)`, 'm').exec(code(read(rel)));
  assert.ok(m, `${rel} has a ${name} job`);
  return m[1];
};

// Positions in a job body, asserted in order: each pattern is found after the one before it.
const assertInOrder = (body, patterns, where) => {
  let at = 0;
  for (const re of patterns) {
    const i = body.slice(at).search(re);
    assert.ok(i >= 0, `${where}: ${re} after offset ${at}`);
    at += i + 1;
  }
};

const KIT_REFS = '<link rel="stylesheet" href="/somi/_kit/tokens.css"><script src="/somi/_kit/theme.js"></script><script src="/somi/_kit/site-nav.js" defer></script>';
const PAGE = `<!doctype html><html><head><title>T</title><link rel="icon" href="/somi/favicon-32.png">${KIT_REFS}</head><body></body></html>`;
const KIT = ['_kit/tokens.css', '_kit/theme.js', '_kit/site-nav.js'];
const has = (...files) => (rel) => files.includes(rel);

test("site.yml's deploy build runs the page's tests between the install and the build", () => {
  const cmd = /site_build_command:\s*'([^']*)'/.exec(code(read('.github/workflows/site.yml')));
  assert.ok(cmd, 'site_build_command is set');
  const steps = cmd[1].split('&&').map((s) => s.trim());
  assert.deepEqual(steps, ['npm --prefix site ci --ignore-scripts', 'npm --prefix site test', 'npm --prefix site run build']);
});

test("publish.yml's docs job tests the page before it builds it", () => {
  assertInOrder(job('.github/workflows/publish.yml', 'docs'), [
    /run: npm --prefix site ci --ignore-scripts/,
    /run: npm --prefix site test\s*$/m,
    /run: npm --prefix site run build/,
  ], 'publish.yml docs');
});

for (const [rel, name] of [['.github/workflows/ci.yml', 'site'], ['.github/workflows/publish.yml', 'docs']]) {
  test(`${rel}'s ${name} job adds the kit to site/dist after the build and checks it strictly`, () => {
    assertInOrder(job(rel, name), [
      /run: npm --prefix site run build/,
      /uses: skathio\/hashira\/\.github\/actions\/site-kit@v3\s/,
      /^\s+dest: site\/dist\s*$/m,
      /run: node site\/scripts\/check-dist\.mjs --kit site\/dist\s*$/m,
    ], `${rel} ${name}`);
  });
}

test('check-dist leaves the kit files to the pages build by default', () => {
  assert.deepEqual(checkBuiltHtml(PAGE, has('favicon-32.png')), []);
});

test('in kit mode, each missing kit file is an asset not emitted', () => {
  for (const missing of KIT) {
    const got = checkBuiltHtml(PAGE, has('favicon-32.png', ...KIT.filter((f) => f !== missing)), { kit: true });
    assert.deepEqual(got, [`asset not emitted: /somi/${missing}`]);
  }
  assert.deepEqual(checkBuiltHtml(PAGE, has('favicon-32.png', ...KIT), { kit: true }), []);
});

test('kit mode still refuses a kit reference from another origin', () => {
  const html = PAGE.replace('/somi/_kit/theme.js', 'https://cdn.example/_kit/theme.js');
  assert.deepEqual(checkBuiltHtml(html, has('favicon-32.png', ...KIT), { kit: true }), ['asset outside /somi/: https://cdn.example/_kit/theme.js']);
});

test('the check-dist command fails a dist without the kit under --kit and passes one with it', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-dist-'));
  try {
    fs.writeFileSync(path.join(dist, 'index.html'), PAGE);
    fs.writeFileSync(path.join(dist, 'favicon-32.png'), '');
    const run = (...args) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8' });
    assert.equal(run(dist).status, 0, 'without --kit the kit is left to the pages build');
    const strict = run('--kit', dist);
    assert.equal(strict.status, 1);
    assert.match(strict.stderr, /asset not emitted: \/somi\/_kit\/tokens\.css/);
    fs.mkdirSync(path.join(dist, '_kit'));
    for (const f of KIT) fs.writeFileSync(path.join(dist, f), '');
    const ok = run('--kit', dist);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(run(dist, '--kit').status, 0, 'the flag may follow the directory');
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
