// hashira v3.4.0's Pages flow, adopted: ci.yml and the release build the page and the docs through pages-site with
// `deploy: false` instead of hand-built jobs, the release deploys that one prebuilt artifact, site.yml installs and
// tests through pages-site's own inputs, the docs take the accent pair from pages.json, the landing's header gets
// the scroll highlight back, and a visitor's theme stored under the old landing's key carries over to the kit's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { REPO } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(REPO, rel));
const code = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const CI = '.github/workflows/ci.yml';
const CHECK = '.github/workflows/site-check.yml';
const PUBLISH = '.github/workflows/publish.yml';
const SITE = '.github/workflows/site.yml';
const PAGES_SITE = /^skathio\/hashira\/\.github\/workflows\/pages-site\.yml@v3$/;
// pages-site's own defaults for the inputs these tests read.
const PAGES_DEFAULTS = { deploy: 'true', prebuilt: 'false', docs: 'true', released: 'false', artifact_name: 'github-pages' };

// The job blocks of a workflow: a two-space-indented key under `jobs:` starts one.
function jobsOf(rel) {
  const text = code(read(rel));
  const parts = text.slice(text.search(/^jobs:\s*$/m)).split(/^ {2}([A-Za-z0-9_-]+):[ \t]*$/m).slice(1);
  const out = {};
  for (let i = 0; i < parts.length; i += 2) out[parts[i]] = parts[i + 1];
  return out;
}

const usesOf = (body) => /^ {4}uses:\s*(\S+)/m.exec(body)?.[1];
const unquote = (v) => v.replace(/\s+#\s.*$/, '').trim().replace(/^(['"])([\s\S]*)\1$/, '$2');

// A one-line value, or a `|` / `>` block scalar from the lines indented below its key.
function scalar(first, rest) {
  const block = /^[|>][-+]?$/.exec(first.trim());
  if (!block) return unquote(first);
  return rest.map((l) => l.trim()).filter(Boolean).join(first.trim().startsWith('|') ? '\n' : ' ');
}

// The `key: value` pairs under a job's `with:` (six-space keys).
function withOf(body) {
  const m = /^ {4}with:[ \t]*\n((?: {6,}.*\n|[ \t]*\n)*)/m.exec(body);
  const out = {};
  if (!m) return out;
  const lines = m[1].split('\n');
  lines.forEach((line, i) => {
    const kv = /^ {6}([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) return;
    const rest = [];
    for (let j = i + 1; j < lines.length && !/^ {6}\S/.test(lines[j]); j++) rest.push(lines[j]);
    out[kv[1]] = scalar(kv[2], rest);
  });
  return out;
}

// The defaults site.yml declares for its workflow_call inputs.
function siteDefaults() {
  const text = code(read(SITE));
  const call = text.slice(text.search(/^ {2}workflow_call:\s*$/m), text.search(/^permissions:/m));
  const out = {};
  for (const m of call.matchAll(/^ {6}([a-z_]+):\s*\n((?: {8,}.*\n)*)/gm)) {
    const d = /^ {8}default:\s*(.+)$/m.exec(m[2]);
    if (d) out[m[1]] = unquote(d[1]);
  }
  return out;
}

// A value site.yml forwards as `${{ inputs.x }}` or `${{ inputs.x == true }}` takes the caller's value.
function forward(value, given) {
  const m = /^\$\{\{\s*inputs\.([a-z_]+)(\s*==\s*true)?\s*\}\}$/.exec(value);
  if (!m) return value;
  const v = given[m[1]] ?? siteDefaults()[m[1]] ?? '';
  return m[2] ? String(v === 'true') : v;
}

// The pages-site inputs each job of a workflow ends up passing, directly or through site.yml.
function pagesCalls(rel) {
  const siteJobs = Object.values(jobsOf(SITE)).filter((b) => PAGES_SITE.test(usesOf(b) ?? ''));
  return Object.entries(jobsOf(rel)).flatMap(([job, body]) => {
    const uses = usesOf(body) ?? '';
    if (PAGES_SITE.test(uses)) return [{ job, inputs: withOf(body) }];
    if (uses !== './.github/workflows/site.yml') return [];
    const given = withOf(body);
    return siteJobs.map((s) => ({ job, inputs: Object.fromEntries(Object.entries(withOf(s)).map(([k, v]) => [k, forward(v, given)])) }));
  });
}

const input = (call, key) => call.inputs[key] ?? PAGES_DEFAULTS[key] ?? '';
const isBuild = (call) => input(call, 'prebuilt') !== 'true';
const deploys = (call) => input(call, 'deploy') !== 'false';
const needsOf = (body) => {
  const m = /^ {4}needs:\s*(.+)$/m.exec(body);
  return m ? m[1].replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean) : [];
};

// What every build of the page holds to, wherever it runs: install from the lockfile with no lifecycle scripts,
// the page's tests as pages-site's test step, and a site build that only builds.
function assertBuildsThePage(call, where) {
  assert.equal(input(call, 'site_output'), 'site/dist', `${where}: site_output`);
  assert.match(input(call, 'install_command'), /npm --prefix site ci --ignore-scripts|cd site && npm ci --ignore-scripts/, `${where}: install_command`);
  assert.match(input(call, 'test_command'), /npm --prefix site (run )?test\b|cd site && npm (run )?test\b/, `${where}: test_command`);
  const build = input(call, 'site_build_command');
  assert.match(build, /npm --prefix site run build|cd site && npm run build/, `${where}: site_build_command builds the page`);
  assert.doesNotMatch(build, /\bnpm\b[^&;|]*\s(ci|install|i|test)\b/, `${where}: site_build_command neither installs nor tests`);
  assert.notEqual(input(call, 'docs'), 'false', `${where}: the docs are built`);
}

// The page's coverage report, through pages-site's coverage_path: a relative path inside the checkout.
function assertCoverage(call, where) {
  const coverage = input(call, 'coverage_path');
  assert.ok(coverage !== '' && !coverage.startsWith('/') && !coverage.split('/').includes('..'), `${where}: coverage_path ${coverage}`);
}

// A hand-built page or docs job: hashira's site-kit or docs-build used as steps, or site/ installed, tested or built in a step.
function assertNoHandBuild(rel) {
  for (const [name, body] of Object.entries(jobsOf(rel))) {
    assert.doesNotMatch(body, /uses:\s*skathio\/hashira\/\.github\/actions\/(site-kit|docs-build)@/, `${rel} ${name}`);
    assert.doesNotMatch(body, /run:\s*npm --prefix site\b/, `${rel} ${name}`);
  }
}

test('pull requests build the page and the docs through pages-site with deploy: false in site-check.yml, not hand-built jobs', () => {
  assertNoHandBuild(CI);
  assertNoHandBuild(CHECK);
  const calls = pagesCalls(CHECK);
  assert.ok(calls.length >= 1, 'a site-check.yml job calls pages-site');
  for (const call of calls) {
    assert.equal(input(call, 'deploy'), 'false', `site-check.yml ${call.job} never deploys`);
    assertBuildsThePage(call, `site-check.yml ${call.job}`);
    assertCoverage(call, `site-check.yml ${call.job}`);
  }
});

test('the release builds the page once, before publish, with deploy: false', () => {
  assertNoHandBuild(PUBLISH);
  const builds = pagesCalls(PUBLISH).filter(isBuild);
  assert.equal(builds.length, 1, `one build: ${builds.map((c) => c.job).join(', ')}`);
  const [build] = builds;
  assert.equal(input(build, 'deploy'), 'false', 'the release build does not deploy');
  assertBuildsThePage(build, `publish.yml ${build.job}`);
  assertCoverage(build, `publish.yml ${build.job}`);
  assert.ok(needsOf(jobsOf(PUBLISH).publish ?? '').includes(build.job), `publish needs ${build.job}`);
});

test('the release deploys the artifact it built, with prebuilt: true and the same artifact_name', () => {
  const calls = pagesCalls(PUBLISH);
  const build = calls.find(isBuild);
  const deploy = calls.filter(deploys);
  assert.ok(build, 'a release build');
  assert.equal(deploy.length, 1, `one deploy: ${deploy.map((c) => c.job).join(', ')}`);
  assert.equal(input(deploy[0], 'prebuilt'), 'true');
  assert.equal(input(deploy[0], 'released'), 'true');
  assert.ok('artifact_name' in deploy[0].inputs, 'the deploy names its artifact');
  assert.notEqual(deploy[0].inputs.artifact_name, '', 'the artifact name is not empty');
  assert.equal(input(deploy[0], 'artifact_name'), input(build, 'artifact_name'));
  assert.ok(needsOf(jobsOf(PUBLISH)[deploy[0].job]).includes('publish'), 'the deploy waits for publish');
});

test('a page-only deploy from site.yml still installs, tests and builds the page through pages-site inputs', () => {
  const jobs = Object.entries(jobsOf(SITE)).filter(([, b]) => PAGES_SITE.test(usesOf(b) ?? ''));
  assert.equal(jobs.length, 1, 'one pages-site job in site.yml');
  // A hand run passes no inputs, so every forwarded value takes site.yml's own default.
  const hand = { job: jobs[0][0], inputs: Object.fromEntries(Object.entries(withOf(jobs[0][1])).map(([k, v]) => [k, forward(v, {})])) };
  assert.ok(isBuild(hand), 'a hand run builds rather than deploying a prebuilt artifact');
  assert.ok(deploys(hand), 'a hand run deploys');
  assertBuildsThePage(hand, 'site.yml');
  assertCoverage(hand, 'site.yml');
});

test("ci.yml's comment no longer says actionlint is skipped by default", () => {
  const text = read(CI);
  assert.doesNotMatch(text, /codeql,actionlint/);
  assert.doesNotMatch(text, /default already skips/i);
});

const hex6 = (c) => (c.length === 4 ? `#${[...c.slice(1)].map((d) => d + d).join('')}` : c).toLowerCase();
const pageAccents = () => [...read('site/src/index.css').matchAll(/--color-accent:\s*(#[0-9a-f]{3,6});/gi)].map((m) => hex6(m[1]));

test('pages.json carries accent_dark, a #rgb or #rrggbb colour', () => {
  const pages = JSON.parse(read('.github/pages.json'));
  assert.ok('accent_dark' in pages, 'accent_dark is set');
  assert.match(pages.accent_dark, /^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
});

test("the docs accent pair is the page's, in light and in dark", () => {
  const pages = JSON.parse(read('.github/pages.json'));
  const light = pages.accent ?? JSON.parse(read('.github/homepage.json')).colour ?? '#1e7d69';
  const dark = pages.accent_dark ?? light;
  const [pageLight, pageDark] = pageAccents();
  assert.ok(pageLight && pageDark, 'a light and a dark --color-accent');
  assert.equal(hex6(light), pageLight, 'light');
  assert.equal(hex6(dark), pageDark, 'dark');
});

test('the docs theme CSS holds no rules on VitePress internals and no accent overrides', () => {
  const pages = JSON.parse(read('.github/pages.json'));
  const files = [...new Set([pages.theme_css, '.github/pages-theme.css'].filter((f) => f && exists(f)))];
  for (const f of files) {
    const css = read(f);
    assert.doesNotMatch(css, /\.VP[A-Z]/, `${f}: a VitePress-internal selector`);
    assert.doesNotMatch(css, /--vp-c-brand|--vp-button-brand/, `${f}: an accent override`);
  }
});

test('the landing keeps the @theme inline radius pin', () => {
  const css = read('site/src/index.css');
  const block = /@theme\s+inline\s*\{([^}]*)\}/.exec(css);
  assert.ok(block, '@theme inline block');
  assert.match(block[1], /--radius-sm:\s*0\.25rem;/);
  assert.match(block[1], /--radius-lg:\s*0\.5rem;/);
});

test('the landing header turns on the kit scroll highlight with <site-nav scrollspy>', () => {
  assert.match(read('site/src/components/Header.tsx'), /<site-nav\b[^>]*\sscrollspy\b/);
});

test("the site-nav test's comment on home_link matches pages.json", () => {
  assert.ok('home_link' in JSON.parse(read('.github/pages.json')));
  assert.doesNotMatch(read('site/test/site-nav.test.tsx'), /absent in somi's today/);
});

// The classic scripts index.html runs before the kit's theme.js: inline, or a file from site/public.
function scriptsBeforeTheme() {
  const html = read('site/index.html');
  const head = html.slice(0, html.search(/<script\b[^>]*src="[^"]*_kit\/theme\.js"/));
  return [...head.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(([, attrs]) => !/type="module"/.test(attrs))
    .map(([, attrs, body]) => {
      const src = /src="\/somi\/([^"]+)"/.exec(attrs)?.[1];
      return src ? read(`site/public/${src}`) : body;
    });
}

// Runs those scripts against a page with the given storage, and returns what is stored afterwards.
function visit(stored) {
  const store = new Map(Object.entries(stored));
  const localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const root = { dataset: {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null };
  const sandbox = { localStorage, document: { documentElement: root }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const s of scriptsBeforeTheme()) vm.runInContext(s, sandbox);
  return Object.fromEntries(store);
}

test("a theme stored under the old landing's somi-theme key becomes the kit's theme before theme.js reads it", () => {
  assert.equal(visit({ 'somi-theme': 'dark' }).theme, 'dark');
  assert.equal(visit({ 'somi-theme': 'light' }).theme, 'light');
});

test('with nothing stored under somi-theme, no theme is stored for the visitor', () => {
  assert.equal(visit({}).theme, undefined);
});

test('site-check.yml runs on every pull request and on main, and never deploys', () => {
  const text = fs.readFileSync(path.join(REPO, CHECK), 'utf8');
  const on = text.slice(text.search(/^on:\s*$/m), text.search(/^permissions:/m));
  assert.match(on, /^ {2}pull_request:\s*$/m, 'on pull_request, with no filter');
  assert.match(on, /^ {2}push:\s*\n {4}branches:\s*\[main\]/m, 'on push to main');
  assert.doesNotMatch(on, /workflow_dispatch|workflow_call/, 'no hand or release entry');
  assert.doesNotMatch(text, /^\s*deploy:\s*true\b/m);
});
