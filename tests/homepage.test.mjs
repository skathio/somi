// The org homepage work in this repo: the homepage manifest and the release ping that tells skathio/skathio.github.io to rebuild.
// The rules come from the request: opt-in manifest at .github/homepage.json, a repository_dispatch ping after publish,
// and a cross-repo token that is a documented secret and never committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const MANIFEST = '.github/homepage.json';
const PUBLISH = '.github/workflows/publish.yml';
// The job blocks of publish.yml: a two-space-indented key under `jobs:` starts one.
const jobs = () => {
  const text = read(PUBLISH);
  const body = text.slice(text.search(/^jobs:\s*$/m));
  const out = {};
  let name = null;
  for (const line of body.split('\n').slice(1)) {
    const m = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) { name = m[1]; out[name] = ''; } else if (name) out[name] += line + '\n';
  }
  return out;
};
const code = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('the homepage manifest exists and is JSON', () => {
  assert.ok(fs.existsSync(path.join(REPO, MANIFEST)), `${MANIFEST} exists`);
  assert.doesNotThrow(() => JSON.parse(read(MANIFEST)));
});

// The shape the homepage build accepts (skathio.github.io docs/manifest.md). A field it refuses
// is dropped from the tile with a warning, so these checks catch that here, before it ships.
test('the manifest uses only the fields the homepage reads, within its limits', () => {
  const m = JSON.parse(read(MANIFEST));
  const known = ['name', 'tagline', 'kind', 'tags', 'colour', 'image', 'links', 'listed'];
  for (const key of Object.keys(m)) assert.ok(known.includes(key), `unknown field ${key}`);
  assert.ok(typeof m.name === 'string' && m.name.trim() && m.name.length <= 40, 'name: 1-40 characters');
  assert.ok(typeof m.tagline === 'string' && m.tagline.trim() && m.tagline.length <= 160, 'tagline: 1-160 characters');
  assert.match(m.colour, /^#[0-9a-f]{6}$/i, 'colour is #rrggbb');
});

const shortText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

test('the card kind and tags fit the homepage limits', () => {
  const m = JSON.parse(read(MANIFEST));
  if ('kind' in m) assert.ok(shortText(m.kind, 24), 'kind: 1-24 characters');
  if (!('tags' in m)) return;
  assert.ok(Array.isArray(m.tags) && m.tags.length <= 5, 'tags: a list of at most 5');
  for (const t of m.tags) assert.ok(shortText(t, 20), `tag "${t}": 1-20 characters`);
});

test('the branding image is a file in this repo, of a type and size the homepage takes', () => {
  const { image } = JSON.parse(read(MANIFEST));
  assert.match(image, /^[A-Za-z0-9._/-]+\.(png|jpe?g|webp|svg)$/, 'a relative image path');
  assert.ok(!image.split('/').includes('..'), 'stays inside the repo');
  const file = path.join(REPO, image);
  assert.ok(fs.existsSync(file), `${image} exists`);
  assert.ok(fs.statSync(file).size <= 512 * 1024, 'at most 512 KB');
  if (image.endsWith('.png')) assert.equal(fs.readFileSync(file).subarray(0, 4).toString('hex'), '89504e47', 'really a PNG');
});

test('the manifest links are optional: when present they are https', () => {
  const m = JSON.parse(read(MANIFEST));
  if (!('links' in m)) return;
  assert.ok(m.links && Object.keys(m.links).length > 0 && Object.keys(m.links).length <= 4, 'links, if given, has 1-4 entries');
  for (const url of Object.values(m.links)) assert.equal(new URL(url).protocol, 'https:');
});

test('publish.yml sends a repository_dispatch ping to skathio/skathio.github.io', () => {
  const text = code(read(PUBLISH));
  assert.match(text, /repository_dispatch|repos\/skathio\/skathio\.github\.io\/dispatches/, 'a repository_dispatch is sent');
  assert.match(text, /skathio\/skathio\.github\.io/, 'the homepage repo is the target');
});

test('the ping runs only after publish succeeds', () => {
  const j = jobs();
  const ping = Object.entries(j).find(([name, body]) => name !== 'publish' && /skathio\/skathio\.github\.io/.test(code(body)));
  assert.ok(ping, 'a job other than publish sends the ping');
  const needs = /^\s+needs:\s*(.+)$/m.exec(ping[1]);
  assert.ok(needs && /\bpublish\b/.test(needs[1]), 'the ping job needs publish');
});

test('the ping stays behind the release gate: a release dispatch with a bump', () => {
  const j = jobs();
  const ping = Object.values(j).find((body) => /skathio\/skathio\.github\.io/.test(code(body)));
  assert.ok(ping);
  assert.match(ping, /github\.event\.inputs\.bump != ''/, 'no ping on a no-op dispatch');
});

test('the cross-repo token is read from a secret, never written into the file', () => {
  const text = code(read(PUBLISH));
  assert.match(text, /\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}/, 'a secret supplies the token');
  for (const rel of [PUBLISH, MANIFEST]) {
    assert.doesNotMatch(read(rel), /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/, `${rel} holds no token`);
  }
});

test('publish.yml is still a manual dispatch with a deny-all baseline', () => {
  const text = code(read(PUBLISH));
  assert.match(text, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(text, /^\s+(push|pull_request|schedule):/m, 'no new trigger');
  assert.match(text, /^permissions: \{\}\s*$/m);
});

test('a missing token skips the ping instead of failing a release that already went out', () => {
  const ping = Object.values(jobs()).find((body) => /skathio\/skathio\.github\.io/.test(code(body)));
  assert.match(ping, /if \[ -z "\$\{GH_TOKEN\}" \]; then[\s\S]*?exit 0/, 'an unset secret exits 0 before gh api');
  assert.ok(ping.indexOf('exit 0') < ping.indexOf('gh api'), 'the check comes before the call');
});

test('homepage.yml pings on a manifest or image change, and skips without a token', () => {
  const wf = read('.github/workflows/homepage.yml');
  const { image } = JSON.parse(read(MANIFEST));
  assert.match(wf, /\.github\/homepage\.json/);
  assert.ok(wf.includes(`'${image}'`), 'the image path triggers a ping');
  assert.match(code(wf), /^permissions: \{\}\s*$/m);
  assert.match(code(wf), /\$\{\{\s*secrets\.HOMEPAGE_DISPATCH_TOKEN\s*\}\}/);
  assert.match(wf, /if \[ -z "\$\{GH_TOKEN\}" \]; then[\s\S]*?exit 0/);
});

test('an expired token or API error on the ping never fails the run', () => {
  const ping = Object.values(jobs()).find((body) => /skathio\/skathio\.github\.io/.test(code(body)));
  assert.match(ping, /continue-on-error: true/, 'publish.yml ping step');
  assert.match(read('.github/workflows/homepage.yml'), /continue-on-error: true/, 'homepage.yml ping step');
});

// The ping holds a cross-repo token, so no trigger may run it on code or text an outsider controls.
test('homepage.yml runs only on pushes to main and by hand, never on PR or comment events', () => {
  const wf = code(read('.github/workflows/homepage.yml'));
  const on = wf.slice(wf.search(/^on:\s*$/m), wf.search(/^permissions:/m));
  const triggers = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(triggers, ['push', 'workflow_dispatch']);
  assert.match(on, /branches: \[main\]/);
});

// One release, one approval: every deploy of the page passes the production Environment's owner
// approval exactly once, at `publish` for a release, or at site.yml's `gate` for a page-only run.
const SITE = '.github/workflows/site.yml';
const siteJobs = () => {
  const body = read(SITE).slice(read(SITE).search(/^jobs:\s*$/m));
  const out = {};
  let name = null;
  for (const line of body.split('\n').slice(1)) {
    const m = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) { name = m[1]; out[name] = ''; } else if (name) out[name] += line + '\n';
  }
  return out;
};

test('a page-only deploy waits for the production approval before anything builds', () => {
  const j = siteJobs();
  assert.match(j.gate, /environment: production/);
  assert.match(j.gate, /if: \$\{\{ !inputs\.released \}\}/);
  assert.match(j.build, /needs: gate/);
  assert.match(j.build, /needs\.gate\.result == 'success' \|\| \(needs\.gate\.result == 'skipped' && inputs\.released\)/);
  assert.match(j.deploy, /needs\.build\.result == 'success'/);
});

test('only the release skips that gate, and only after publish', () => {
  const site = jobs().site;
  assert.match(site, /needs: publish/);
  assert.match(site, /released: true/);
  assert.match(jobs().publish, /environment: production/);
  for (const [name, body] of Object.entries(jobs())) if (name !== 'site') assert.doesNotMatch(body, /released: true/, name);
});
