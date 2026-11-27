// What reaches Pages has passed the page's own tests and carries the kit its header loads: every pages-site build
// runs `npm --prefix site test` as its test step (see pages-adopt-v34.test.mjs), and ci.yml and the release check
// the artifact pages-site built, kit included, with check-dist's strict mode, where the kit files must exist like
// any other asset. pages-site's own kit check reads relative references only, and the page's are absolute.
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

// The `with:` value of a key in a job body, unquoted; one line only.
const withValue = (body, key) => {
  const m = new RegExp(`^\\s+${key}:\\s*(.+?)\\s*$`, 'm').exec(body);
  return m ? m[1].replace(/^(['"])(.*)\1$/, '$2') : undefined;
};
const needsOf = (body) => {
  const m = /^ {4}needs:\s*(.+)$/m.exec(body);
  return m ? m[1].replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean) : [];
};

for (const [rel, build, check] of [['.github/workflows/site-check.yml', 'site', 'site-kit'], ['.github/workflows/publish.yml', 'site-build', 'site-kit']]) {
  test(`${rel}'s ${check} job checks the artifact ${build} built, kit included, strictly`, () => {
    const body = job(rel, check);
    assert.ok(needsOf(body).includes(build), `${check} needs ${build}`);
    // The download step's `name:`, under its `with:`, not the job's own.
    const downloaded = /^ {10}name:\s*(\S+)\s*$/m.exec(body)?.[1];
    assert.equal(downloaded, withValue(job(rel, build), 'artifact_name') ?? 'github-pages', 'the artifact the build uploaded');
    assertInOrder(body, [
      /uses: actions\/download-artifact@[0-9a-f]{40}\s/,
      /tar -xf "\$\{RUNNER_TEMP\}\/pages\/artifact\.tar" -C "\$\{RUNNER_TEMP\}\/site"/,
      /node site\/scripts\/check-dist\.mjs --kit "\$\{RUNNER_TEMP\}\/site"\s*$/m,
    ], `${rel} ${check}`);
  });
}

test('the release publishes nothing before the kit check passed', () => {
  assert.ok(needsOf(job('.github/workflows/publish.yml', 'publish')).includes('site-kit'));
});

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
