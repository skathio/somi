// The project page and its docs move to hashira's Pages flow: site.yml calls pages-site.yml@v3 with the Vite build,
// .github/pages.json describes the docs as hashira's adoption guide (docs/flows/pages.md) defines it, and the old
// docs-site/ package is gone with nothing left calling it. The page stays at /somi/ and the docs at /somi/docs/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(REPO, rel));
const code = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const SITE = '.github/workflows/site.yml';
const PUBLISH = '.github/workflows/publish.yml';
const PAGES = '.github/pages.json';
const WORKFLOWS = fs.readdirSync(path.join(REPO, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f)).map((f) => `.github/workflows/${f}`);

// The job blocks of a workflow: a two-space-indented key under `jobs:` starts one.
const jobsOf = (rel) => {
  const text = code(read(rel));
  const out = {};
  let name = null;
  for (const line of text.slice(text.search(/^jobs:\s*$/m)).split('\n').slice(1)) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) { name = m[1]; out[name] = ''; } else if (name) out[name] += `${line}\n`;
  }
  return out;
};

// The `key: value` pairs directly under a job's `permissions:` (four-space indent, six for entries).
const grants = (body) => {
  const block = /^ {4}permissions:[ \t]*(\{\})?[ \t]*\n((?: {6}.*\n)*)/m.exec(body);
  if (!block) return null;
  const out = {};
  for (const m of block[2].matchAll(/^ {6}([a-z-]+):\s*([a-z]+)/gm)) out[m[1]] = m[2];
  return out;
};

// The `with:` value of a key, unquoted; one line only, as site.yml writes its inputs.
const withValue = (body, key) => {
  const m = new RegExp(`^\\s+${key}:\\s*(.+?)\\s*$`, 'm').exec(body);
  return m ? m[1].replace(/^(['"])(.*)\1$/, '$2') : undefined;
};

const pagesJob = () => Object.values(jobsOf(SITE)).find((b) => /uses:\s*skathio\/hashira\/\.github\/workflows\/pages-site\.yml@/.test(b)) ?? '';

test('site.yml calls hashira pages-site.yml at @v3', () => {
  const job = pagesJob();
  assert.ok(job !== '', 'a site.yml job uses skathio/hashira/.github/workflows/pages-site.yml');
  assert.match(job, /uses:\s*skathio\/hashira\/\.github\/workflows\/pages-site\.yml@v3\s/);
});

test('the site is the Vite build, written to site/dist', () => {
  const job = pagesJob();
  assert.equal(withValue(job, 'site_output'), 'site/dist');
  const build = withValue(job, 'site_build_command');
  assert.ok(build, 'site_build_command is set');
  assert.match(build, /npm --prefix site run build|cd site && npm run build/, 'runs the site package build (Vite)');
  // pages-site's install_command installs site/ before the build.
  assert.match(withValue(job, 'install_command') ?? '', /npm --prefix site ci|cd site && npm ci/, 'installs site/ before the build');
});

test('the docs are still built: the caller never turns them off', () => {
  assert.notEqual(withValue(pagesJob(), 'docs'), 'false');
});

test('site.yml keeps a deny-all baseline and its caller job grants only what pages-site needs', () => {
  assert.match(read(SITE), /^permissions: \{\}\s*$/m);
  assert.deepEqual(grants(pagesJob()), { contents: 'read', pages: 'write', 'id-token': 'write' });
});

test('the release passes its approval through: publish.yml calls site.yml with released: true and site.yml forwards it', () => {
  const site = jobsOf(PUBLISH).site;
  assert.ok(site, 'publish.yml has a site job');
  assert.match(site, /uses:\s*\.\/\.github\/workflows\/site\.yml/);
  assert.match(site, /released: true/);
  assert.match(site, /needs:\s*(publish|\[[^\]]*\bpublish\b[^\]]*\])/);
  assert.match(withValue(pagesJob(), 'released') ?? '', /^\$\{\{\s*inputs\.released\b/);
});

test("publish.yml's site job grants only what pages-site needs", () => {
  assert.deepEqual(grants(jobsOf(PUBLISH).site), { contents: 'read', pages: 'write', 'id-token': 'write' });
});

test('site.yml still deploys only by hand or from a release, never on a push', () => {
  const wf = code(read(SITE));
  const on = wf.slice(wf.search(/^on:\s*$/m), wf.search(/^permissions:/m));
  const triggers = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(triggers, ['workflow_call', 'workflow_dispatch']);
});

test('every hashira ref in the workflows tracks @v3', () => {
  for (const wf of WORKFLOWS) {
    for (const m of code(read(wf)).matchAll(/uses:\s*skathio\/hashira\/[^\s@]+@(\S+)/g)) assert.equal(m[1], 'v3', `${wf}: ${m[0]}`);
  }
});

test('docs-site/ is removed from the repository', () => {
  const tracked = execFileSync('git', ['ls-files', '--', 'docs-site'], { cwd: REPO, encoding: 'utf8' }).trim();
  assert.equal(tracked, '', 'no tracked file under docs-site/');
});

test('nothing calls the old docs build', () => {
  for (const rel of [...WORKFLOWS, 'package.json', 'site/package.json']) {
    assert.doesNotMatch(code(read(rel)), /docs-site/, rel);
  }
});

// The job names a job body lists under `needs:`, as a single name or a [list].
const needsOf = (body) => {
  const m = /^ {4}needs:\s*(.+)$/m.exec(body);
  return m ? m[1].replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean) : [];
};

test('every job publish.yml, ci.yml and site-check.yml wait for still exists', () => {
  for (const wf of [PUBLISH, '.github/workflows/ci.yml', '.github/workflows/site-check.yml']) {
    const jobs = jobsOf(wf);
    const missing = Object.entries(jobs).flatMap(([name, body]) => needsOf(body).filter((d) => !(d in jobs)).map((d) => `${name} needs ${d}`));
    assert.deepEqual(missing, [], wf);
  }
});

test('the landing stays at /somi/ and holds no docs or _kit folder of its own', () => {
  assert.match(read('site/vite.config.ts'), /base:\s*['"]\/somi\/['"]/);
  // Vite copies site/public into site/dist, and pages-site fails a site that brings its own docs/ or _kit/.
  for (const own of ['site/public/docs', 'site/public/_kit']) assert.ok(!exists(own), `${own} must not exist`);
});

test('docs/ holds only files the docs build publishes', () => {
  const walk = (dir) => fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  for (const f of walk('docs')) {
    assert.match(f, /\.(md|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|pdf|txt|csv)$/i, f);
    assert.doesNotMatch(f, /[[\]]/, f);
  }
});
