// Rules for the VitePress docs site and docs-site/build.sh: the toolchain, the Pages folder
// site/dist with the overview page at its root and the docs under docs/, the failure cases,
// docs/ read and never written, the base and home page, the sidebar, VERSIONING.md kept on
// GitHub, where relative links go, GitHub heading ids, the dead-link check, Markdown HTML and
// braces as text, local search and the outline, the palette and fonts, nothing from another
// origin, the theme shared through somi-theme, and the logo, favicon and nav links.
//
// Every build runs build.sh from the root of a copy of the working tree, so the cases never
// race each other or another test file, and the real repo is never written. The copies run in
// parallel. A case that needs the build skips when docs-site/node_modules is missing.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const docsSite = dirname(fileURLToPath(import.meta.url));
const root = join(docsSite, '..');
const ORIGIN = 'https://skathio.github.io';
const PAGES_BASE = '/somi/';
const BASE = '/somi/docs/';
const REPO = 'https://github.com/skathio/somi';
const BLOB = `${REPO}/blob/main/`;
const UNPUBLISHED = ['VERSIONING.md'];
const SIDEBAR = [
  ['getting-started.md', 'Getting started'], ['workflows.md', 'Workflows'], ['commands.md', 'Commands'],
  ['configuration.md', 'Configuration'], ['hosts.md', 'Hosts'], ['shards.md', 'Shards'],
  ['sandbox.md', 'Sandbox and trust'], ['ARCHITECTURE.md', 'Architecture'], ['BENCHMARK.md', 'Benchmark'],
  ['MIGRATING-TO-5.md', 'Migrating from 4.1 to 5.0'],
];
const KEY = 'somi-theme';
const VP_KEY = 'vitepress-theme-appearance';
const OTHER_VALUES = ['auto', 'sepia', '', 'Dark', 'LIGHT', 'null'];
const PALETTE = ['canvas', 'surface', 'ink', 'muted', 'line', 'code', 'accent', 'accent-soft'];
const EXTRA_PAGE = 'zz-extra-page.md';
const EXTRA_H1 = 'An extra page nobody listed';
const BUILD_KILL_MS = 900_000;
const hasModules = existsSync(join(docsSite, 'node_modules'));
const needsBuild = { skip: !hasModules && 'needs `npm ci --ignore-scripts` in docs-site/' };

const read = (path) => readFileSync(path, 'utf8');
const docSources = () => readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md')).sort();
const published = () => docSources().filter((md) => !UNPUBLISHED.includes(md));

// ---------------------------------------------------------------- copies of the working tree

// The tracked and untracked files git does not ignore. node_modules is linked in, not copied,
// whether it is installed as a folder or as a link.
function workingTreeFiles() {
  const listed = spawnSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  const copyable = (f) => existsSync(join(root, f)) && !lstatSync(join(root, f)).isDirectory();
  return listed.stdout.split('\0').filter((f) => f && !f.split('/').includes('node_modules')).filter(copyable);
}

function copyEntry(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  return lstatSync(from).isSymbolicLink() ? symlinkSync(readlinkSync(from), to) : cpSync(from, to);
}

// docsModules: 'link' to the installed docs-site/node_modules, 'empty' for a folder without VitePress, or 'none'.
function linkModules(tmp, { siteModules = true, docsModules = 'link' }) {
  const site = join(root, 'site', 'node_modules');
  if (siteModules && existsSync(site)) { symlinkSync(site, join(tmp, 'site', 'node_modules')); }
  if (docsModules === 'link' && hasModules) { symlinkSync(join(docsSite, 'node_modules'), join(tmp, 'docs-site', 'node_modules')); }
  if (docsModules === 'empty') { mkdirSync(join(tmp, 'docs-site', 'node_modules'), { recursive: true }); }
}

function copyWorkingTree(modules = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'somi-docs-site-'));
  for (const f of workingTreeFiles()) { copyEntry(join(root, f), join(tmp, f)); }
  linkModules(tmp, modules);
  return tmp;
}

function runBuild(cwd) {
  return new Promise((done) => {
    const child = spawn('bash', ['docs-site/build.sh'], { cwd, env: process.env });
    const out = { stdout: '', stderr: '' };
    child.stdout.on('data', (d) => { out.stdout += d; });
    child.stderr.on('data', (d) => { out.stderr += d; });
    const kill = setTimeout(() => child.kill('SIGKILL'), BUILD_KILL_MS);
    child.on('close', (status) => { clearTimeout(kill); done({ ...out, status }); });
  });
}

function git(cwd, ...args) {
  const run = spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(run.status, 0, `git ${args.join(' ')} failed:\n${run.stderr}`);
  return run.stdout;
}

function snapshot(dir) {
  const files = {};
  for (const f of readdirSync(dir, { recursive: true })) {
    const p = join(dir, f);
    if (!statSync(p).isDirectory()) { files[f] = createHash('sha256').update(readFileSync(p)).digest('hex'); }
  }
  return files;
}

// A page nobody listed, with links that leave docs/, reach VERSIONING.md or a folder, or name a
// published page, and text that Markdown HTML or a Vue template would turn into something else.
function extraPage(tmp) {
  const firstH2 = read(join(tmp, 'docs', 'getting-started.md')).match(/^## (.+)$/m)?.[1] ?? '';
  const slug = githubSlug(firstH2);
  const links = [
    '[a](../CHANGELOG.md#unreleased)', '[b](../site/README.md?plain=1#x)', '[c](../.github/workflows/site.yml)',
    '[d](VERSIONING.md#tags)', '[e](./VERSIONING.md?plain=1)', '[f](../benchmarks/records/)',
    `[g](getting-started.md#${slug})`, '[h](./configuration.md)',
  ];
  return [
    `# ${EXTRA_H1}`, '', '## Links', '', links.join(' '), '', '## Braces', '',
    'Text {{ 1 + 1 }} and `{{ 2 + 2 }}` and <span class="raw-html">raw</span>.', '',
  ].join('\n');
}

// The listed page no other docs page links to, so removing it can fail the build only by the listing rule.
function unlinkedListedPage(tmp) {
  const sources = docSources().map((md) => read(join(tmp, 'docs', md)));
  const linked = (md) => sources.some((s) => s.includes(`](${md}`) || s.includes(`](./${md}`));
  return SIDEBAR.map(([md]) => md).reverse().find((md) => !linked(md)) ?? 'BENCHMARK.md';
}

const SCENARIOS = {
  main: { prepare: (tmp) => { git(tmp, 'init', '-q'); git(tmp, 'add', '-A'); } },
  extra: { prepare: (tmp) => writeFileSync(join(tmp, 'docs', EXTRA_PAGE), extraPage(tmp)) },
  deadLink: { prepare: (tmp) => appendFileSync(join(tmp, 'docs', 'shards.md'), '\n\n[dead](no-such-page.md)\n') },
  listedMissing: { prepare: (tmp) => rmSync(join(tmp, 'docs', unlinkedListedPage(tmp))) },
  docsInSiteDist: { prepare: (tmp) => { mkdirSync(join(tmp, 'site', 'public', 'docs'), { recursive: true }); writeFileSync(join(tmp, 'site', 'public', 'docs', 'stale.html'), 'stale'); } },
  docsIndex: { prepare: (tmp) => writeFileSync(join(tmp, 'docs', 'index.md'), '# Index\n') },
  noSiteModules: { copy: { siteModules: false } },
  noVitepress: { copy: { docsModules: 'empty' }, always: true },
};

const state = { dirs: {}, runs: {}, before: {} };

before(async () => {
  const names = Object.keys(SCENARIOS).filter((n) => hasModules || SCENARIOS[n].always);
  for (const name of names) {
    state.dirs[name] = copyWorkingTree(SCENARIOS[name].copy);
    SCENARIOS[name].prepare?.(state.dirs[name]);
  }
  if (state.dirs.main) {
    state.before.docs = snapshot(join(state.dirs.main, 'docs'));
    state.before.git = git(state.dirs.main, 'status', '--porcelain', '--untracked-files=all');
  }
  const runs = await Promise.all(names.map((n) => runBuild(state.dirs[n])));
  names.forEach((n, i) => { state.runs[n] = runs[i]; });
});

after(() => { for (const dir of Object.values(state.dirs)) { rmSync(dir, { recursive: true, force: true }); } });

function built(name = 'main') {
  const run = state.runs[name];
  assert.equal(run?.status, 0, `docs-site/build.sh failed:\n${run?.stdout}\n${run?.stderr}`);
  return join(state.dirs[name], 'site', 'dist');
}

// ---------------------------------------------------------------- reading the built site

function decode(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

const text = (fragment) => decode(fragment.replace(/<[^>]*>/g, '')).replace(/​/g, '').trim();

// The file under site/dist that GitHub Pages serves for a /somi/... path, or null.
function servedFile(dist, pathname) {
  if (!pathname.startsWith(PAGES_BASE)) { return null; }
  const rel = decodeURIComponent(pathname.slice(PAGES_BASE.length));
  const candidates = rel === '' || rel.endsWith('/') ? [`${rel}index.html`] : [rel, `${rel}.html`, `${rel}/index.html`];
  return candidates.find((c) => existsSync(join(dist, c)) && !statSync(join(dist, c)).isDirectory()) ?? null;
}

// The built page of a doc, relative to site/dist. Getting started is the docs home page.
function builtPageFor(dist, md) {
  const candidates = [`docs/${md.replace(/\.md$/, '.html')}`, ...(md === 'getting-started.md' ? ['docs/index.html'] : [])];
  return candidates.find((c) => existsSync(join(dist, c))) ?? null;
}

function anchors(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: decode(m[1].match(/\bhref="([^"]*)"/)?.[1] ?? ''), inner: m[2],
  }));
}

// Each link of a built page, resolved as the browser resolves it, with the file it opens.
function resolvedLinks(dist, page) {
  const pageUrl = new URL(PAGES_BASE + page, ORIGIN);
  return anchors(read(join(dist, page))).filter((a) => a.href).map((a) => {
    const url = new URL(a.href, pageUrl);
    return { ...a, url, file: url.origin === ORIGIN ? servedFile(dist, url.pathname) : null };
  });
}

const headOf = (html) => html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';

function sourceLinks(md) {
  return [...read(join(root, 'docs', md)).matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])
    .filter((h) => !/^(?:[a-z]+:|#|\/)/i.test(h));
}

function githubSlug(heading) {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-');
}

// The GitHub heading ids of a doc's H2 and H3 headings, outside code fences, repeats numbered.
function sourceHeadingIds(md) {
  const prose = read(join(root, 'docs', md)).replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, '');
  const seen = new Map();
  const headings = [...prose.matchAll(/^(#{1,6}) (.+)$/gm)].map(([, marks, heading]) => {
    const base = githubSlug(heading.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*]/g, ''));
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { level: marks.length, id: n ? `${base}-${n}` : base };
  });
  return headings.filter((h) => h.level === 2 || h.level === 3).map((h) => h.id);
}

async function siteConfig(name = 'main') {
  built(name);
  const { resolveConfig } = await import('vitepress');
  return resolveConfig(join(state.dirs[name], 'docs-site'), 'build', 'production');
}

async function sidebarItems(name) {
  const sidebar = (await siteConfig(name)).userConfig.themeConfig?.sidebar;
  const groups = Array.isArray(sidebar) ? sidebar : Object.values(sidebar ?? {}).flat();
  const walk = (items) => items.flatMap((i) => [...(i.link ? [i] : []), ...walk(i.items ?? [])]);
  return walk(groups).map((i) => ({ text: decode(i.text), link: i.link }));
}

function searchIndex(dist) {
  const chunks = join(dist, 'docs', 'assets', 'chunks');
  const files = existsSync(chunks) ? readdirSync(chunks).filter((f) => f.startsWith('@localSearchIndex')) : [];
  assert.ok(files.length > 0, 'no local search index was built');
  return files.map((f) => read(join(chunks, f))).join('\n');
}

// The single line a refused build writes to stderr, after checking it is the script's own.
function refusal(name) {
  const run = state.runs[name];
  assert.ok(existsSync(join(docsSite, 'build.sh')), 'docs-site/build.sh does not exist');
  assert.notEqual(run.status, 0, `build.sh exited 0:\n${run.stdout}\n${run.stderr}`);
  const lines = run.stderr.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `stderr is not one line:\n${run.stderr}`);
  assert.ok(lines[0].trim(), 'stderr is empty');
  assert.doesNotMatch(lines[0], /No such file|command not found|line \d+:/, 'a shell error, not a message from build.sh');
  return lines[0];
}

// ---------------------------------------------------------------- the project

describe('the docs-site project', () => {
  const pkg = () => JSON.parse(read(join(docsSite, 'package.json')));

  test('package.json pins VitePress 1.6.4, has build and test scripts and overrides, and runs run-tests.mjs', () => {
    assert.equal(pkg().devDependencies?.vitepress ?? pkg().dependencies?.vitepress, '1.6.4');
    assert.equal(typeof pkg().scripts?.build, 'string', 'no build script');
    assert.equal(typeof pkg().scripts?.test, 'string', 'no test script');
    assert.ok(pkg().overrides && Object.keys(pkg().overrides).length > 0, 'no overrides');
    assert.equal(pkg().main, 'run-tests.mjs');
    assert.ok(existsSync(join(docsSite, 'run-tests.mjs')));
  });

  test('the lockfile installs VitePress 1.6.4 and the overridden versions, and is not ignored by git', () => {
    const lock = JSON.parse(read(join(docsSite, 'package-lock.json')));
    assert.equal(lock.packages?.['node_modules/vitepress']?.version, '1.6.4');
    for (const [name, version] of Object.entries(pkg().overrides ?? {})) {
      if (typeof version === 'string') { assert.equal(lock.packages?.[`node_modules/${name}`]?.version, version, name); }
    }
    const ignored = spawnSync('git', ['check-ignore', '-q', 'docs-site/package-lock.json'], { cwd: root });
    assert.equal(ignored.status, 1, 'docs-site/package-lock.json is gitignored');
  });

  test('the config, the theme entry and custom.css are in .vitepress', () => {
    for (const f of ['config.mts', 'theme/index.ts', 'theme/custom.css']) {
      assert.ok(existsSync(join(docsSite, '.vitepress', f)), `.vitepress/${f} is missing`);
    }
  });

  test('artifacts/ and docs-site/node_modules are gitignored', () => {
    for (const p of ['artifacts/docs-site/src/x.md', 'artifacts/x', 'docs-site/node_modules/x']) {
      assert.equal(spawnSync('git', ['check-ignore', '-q', p], { cwd: root }).status, 0, `${p} is not ignored`);
    }
  });
});

// ---------------------------------------------------------------- build.sh and the Pages folder

describe('build.sh builds site/dist', needsBuild, () => {
  test('the build exits 0 and prints no dead-link warning', () => {
    built();
    assert.doesNotMatch(`${state.runs.main.stdout}\n${state.runs.main.stderr}`, /dead link/i);
  });

  test('site/dist holds the overview page at its root, built with check-dist', () => {
    const dist = built();
    const title = read(join(state.dirs.main, 'site', 'index.html')).match(/<title>[^<]*<\/title>/)[0];
    assert.ok(read(join(dist, 'index.html')).includes(title), 'site/dist/index.html is not the overview page');
    assert.match(state.runs.main.stdout + state.runs.main.stderr, /check-dist: .* is self-contained/, 'check-dist did not run');
  });

  test('site/dist/docs holds the docs site, with its home page at docs/index.html', () => {
    assert.ok(existsSync(join(built(), 'docs', 'index.html')));
  });

  test('the build leaves every file under docs/ unchanged and adds none', () => {
    assert.deepEqual(snapshot(join(built(), '..', '..', 'docs')), state.before.docs);
  });

  test('the build leaves git status as it was: no change and no untracked file', () => {
    built();
    assert.equal(git(state.dirs.main, 'status', '--porcelain', '--untracked-files=all'), state.before.git);
  });

  test('VitePress reads the docs/*.md files byte for byte from under artifacts/docs-site', async () => {
    const { srcDir } = await siteConfig();
    const stage = join(state.dirs.main, 'artifacts', 'docs-site');
    assert.ok(!relative(stage, srcDir).startsWith('..'), `${srcDir} is outside artifacts/docs-site`);
    for (const md of published()) {
      assert.equal(read(join(srcDir, md)), read(join(root, 'docs', md)), `${md} was not staged unchanged`);
    }
  });
});

describe('build.sh refuses with one line on stderr', () => {
  test('when docs-site/node_modules/vitepress is missing', () => { assert.ok(refusal('noVitepress')); });
  test('when site/node_modules is missing', needsBuild, () => { assert.ok(refusal('noSiteModules')); });
  test('when site/dist/docs exists after the site build', needsBuild, () => { assert.ok(refusal('docsInSiteDist')); });
  test('when docs/index.md exists', needsBuild, () => { assert.ok(refusal('docsIndex')); });
});

describe('a failed VitePress build', needsBuild, () => {
  test('a dead link fails the build and leaves no site/dist behind', () => {
    built();
    assert.notEqual(state.runs.deadLink.status, 0, 'the build passed with a dead link');
    assert.equal(existsSync(join(state.dirs.deadLink, 'site', 'dist')), false, 'site/dist was left behind');
  });

  test('a listed page missing from docs/ fails the build and leaves no site/dist behind', () => {
    built();
    assert.notEqual(state.runs.listedMissing.status, 0, 'the build passed with a listed page missing');
    assert.equal(existsSync(join(state.dirs.listedMissing, 'site', 'dist')), false, 'site/dist was left behind');
  });

  test('the dead-link check is not switched off', async () => {
    assert.equal((await siteConfig()).userConfig.ignoreDeadLinks, undefined);
  });
});

// ---------------------------------------------------------------- pages, base and sidebar

describe('published pages', needsBuild, () => {
  test('every docs/*.md except VERSIONING.md gets a page; VERSIONING.md gets none', () => {
    const dist = built();
    for (const md of published()) { assert.ok(builtPageFor(dist, md), `${md} has no built page`); }
    assert.equal(existsSync(join(dist, 'docs', 'VERSIONING.html')), false);
    assert.equal(existsSync(join(dist, 'docs', 'VERSIONING', 'index.html')), false);
  });

  test('the base is /somi/docs/ and every local head asset is under it', async () => {
    assert.equal((await siteConfig()).site.base, BASE);
    const dist = built();
    for (const md of published()) {
      const head = headOf(read(join(dist, builtPageFor(dist, md))));
      const urls = [...head.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
      for (const u of urls) { assert.ok(u.startsWith(BASE), `${md}: ${u} is not under ${BASE}`); }
    }
  });

  test('/somi/docs/ opens docs/getting-started.md through a rewrites entry', async () => {
    assert.equal((await siteConfig()).userConfig.rewrites?.['getting-started.md'], 'index.md');
    const h1 = read(join(built(), 'docs', 'index.html')).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '';
    const want = read(join(root, 'docs', 'getting-started.md')).match(/^# (.+)$/m)[1];
    assert.equal(text(h1.replace(/<a\b[^>]*class="header-anchor"[\s\S]*?<\/a>/g, '')), want);
  });

  test('the sidebar lists the ten pages in the requested order and nothing else today', async () => {
    assert.deepEqual((await sidebarItems('main')).map((i) => i.text), SIDEBAR.map(([, label]) => label));
  });

  test('each sidebar entry opens the page it names', async () => {
    const dist = built();
    const items = await sidebarItems('main');
    for (const [md, label] of SIDEBAR) {
      const item = items.find((i) => i.text === label);
      const file = item && servedFile(dist, new URL(item.link.replace(/^\//, ''), new URL(BASE, ORIGIN)).pathname);
      assert.equal(file, builtPageFor(dist, md), `${label} does not open ${md}`);
    }
  });

  test('a published page not in the list is added after them under its H1, and gets a page', async () => {
    const items = (await sidebarItems('extra')).map((i) => i.text);
    assert.deepEqual(items.slice(0, SIDEBAR.length), SIDEBAR.map(([, label]) => label));
    assert.ok(items.indexOf(EXTRA_H1) >= SIDEBAR.length, `"${EXTRA_H1}" is not listed after the ten pages`);
    assert.ok(builtPageFor(built('extra'), EXTRA_PAGE), `${EXTRA_PAGE} has no built page`);
  });

  test('VERSIONING.md is in neither the sidebar nor the search index', async () => {
    for (const name of ['main', 'extra']) {
      assert.equal((await sidebarItems(name)).some((i) => /VERSIONING/i.test(i.link)), false, `${name}: in the sidebar`);
      assert.doesNotMatch(searchIndex(built(name)), /\/somi\/docs\/VERSIONING/i, `${name}: in the search index`);
    }
  });
});

// ---------------------------------------------------------------- links and heading ids

function expectedGithubUrl(md, href) {
  const u = new URL(href, `https://repo.test/docs/${md}`);
  const path = decodeURIComponent(u.pathname.slice(1));
  if (path.startsWith('docs/') && !UNPUBLISHED.includes(path.slice('docs/'.length))) { return null; }
  const folder = existsSync(join(root, path)) && statSync(join(root, path)).isDirectory();
  return `${REPO}/${folder ? 'tree' : 'blob'}/main/${u.pathname.slice(1)}${u.search}${u.hash}`;
}

// Every [page, href] pair of the relative links in the published pages' sources.
const linkPairs = () => published().flatMap((md) => sourceLinks(md).map((href) => [md, href]));

const sameUrl = (a, b) => a.replace(/\/(?=[?#]|$)/, '') === b.replace(/\/(?=[?#]|$)/, '');

describe('links', needsBuild, () => {
  test('relative links that leave docs/ go to the GitHub blob, or the tree for a folder, anchor kept', () => {
    const dist = built();
    const outbound = linkPairs().map(([md, href]) => [md, expectedGithubUrl(md, href)]).filter(([, want]) => want);
    assert.ok(outbound.length > 0, 'no outbound links were checked');
    for (const [md, want] of outbound) {
      const have = resolvedLinks(dist, builtPageFor(dist, md)).map((l) => l.href);
      assert.ok(have.some((h) => sameUrl(h, want)), `${md}: no link to ${want}`);
    }
  });

  test('links between published pages open the built page with the anchor kept', () => {
    const dist = built();
    const between = linkPairs().filter(([md, href]) => !expectedGithubUrl(md, href));
    assert.ok(between.length > 0, 'no links between pages were checked');
    for (const [md, href] of between) {
      const u = new URL(href, `https://repo.test/docs/${md}`);
      const want = builtPageFor(dist, decodeURIComponent(u.pathname.slice('/docs/'.length)));
      const links = resolvedLinks(dist, builtPageFor(dist, md));
      assert.ok(links.some((l) => l.file === want && l.url.hash === u.hash), `${md}: ${href} does not open ${want}${u.hash}`);
    }
  });

  test('a page linking out of docs/, to VERSIONING.md or to a folder gets GitHub URLs with anchor and query kept', () => {
    const dist = built('extra');
    const have = resolvedLinks(dist, builtPageFor(dist, EXTRA_PAGE)).map((l) => l.href);
    for (const want of [
      `${BLOB}CHANGELOG.md#unreleased`, `${BLOB}site/README.md?plain=1#x`, `${BLOB}.github/workflows/site.yml`,
      `${BLOB}docs/VERSIONING.md#tags`, `${BLOB}docs/VERSIONING.md?plain=1`, `${REPO}/tree/main/benchmarks/records/`,
    ]) { assert.ok(have.some((h) => sameUrl(h, want)), `missing ${want}`); }
  });

  test('a link to a published page, the docs home page included, opens it with the anchor kept', () => {
    const dist = built('extra');
    const links = resolvedLinks(dist, builtPageFor(dist, EXTRA_PAGE));
    const firstH2 = read(join(root, 'docs', 'getting-started.md')).match(/^## (.+)$/m)[1];
    const home = builtPageFor(dist, 'getting-started.md');
    assert.ok(links.some((l) => l.file === home && l.url.hash === `#${githubSlug(firstH2)}`), 'getting-started.md#… is not linked');
    assert.ok(links.some((l) => l.file === builtPageFor(dist, 'configuration.md')), './configuration.md is not linked');
  });

  test("H2 and H3 ids follow GitHub's slug rule on every published page", () => {
    const dist = built();
    for (const md of published()) {
      const ids = new Set([...read(join(dist, builtPageFor(dist, md))).matchAll(/<h[23]\b[^>]*\bid="([^"]*)"/g)].map((m) => decode(m[1])));
      for (const id of sourceHeadingIds(md)) { assert.ok(ids.has(id), `${md}: no heading id "${id}"`); }
    }
  });
});

describe('Markdown rendering', needsBuild, () => {
  const extraHtml = () => { const dist = built('extra'); return read(join(dist, builtPageFor(dist, EXTRA_PAGE))); };

  test('HTML in the Markdown renders as text, not as an element', () => {
    assert.doesNotMatch(extraHtml(), /<span\b[^>]*raw-html/);
    assert.ok(text(extraHtml()).includes('<span class="raw-html">raw</span>'), 'the HTML is not shown as text');
  });

  test('{{ }} in text and inline code renders as text, never as a Vue expression', () => {
    const body = text(extraHtml());
    assert.ok(body.includes('{{ 1 + 1 }}'), 'the braces in text were evaluated or dropped');
    assert.ok(body.includes('{{ 2 + 2 }}'), 'the braces in inline code were evaluated or dropped');
  });
});

// ---------------------------------------------------------------- search and outline

describe('search and outline', needsBuild, () => {
  test('local search is on and indexes every published page', async () => {
    assert.equal((await siteConfig()).userConfig.themeConfig?.search?.provider, 'local');
    for (const [name, sources] of [['main', published()], ['extra', [...published(), EXTRA_PAGE]]]) {
      const dist = built(name);
      const pages = new Set([...searchIndex(dist).matchAll(/(\/somi\/docs\/[^"#\\]*)#/g)].map((m) => servedFile(dist, m[1])));
      const missing = sources.filter((md) => !pages.has(builtPageFor(dist, md)));
      assert.deepEqual(missing, [], `${name}: missing from the search index`);
    }
  });

  test('the outline shows H2 and H3', async () => {
    const outline = (await siteConfig()).userConfig.themeConfig?.outline;
    assert.deepEqual(Array.isArray(outline) ? outline : outline?.level, [2, 3]);
  });
});

// ---------------------------------------------------------------- palette, fonts, origin

// The custom properties of each CSS block whose selector matches, later ones winning.
function cssVars(css, selector) {
  const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => selector(m[1].split(';').pop().trim()));
  const declarations = blocks.flatMap((m) => [...m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)]);
  return Object.fromEntries(declarations.map((d) => [d[1], d[2].trim()]));
}

const hex = (v) => (/^#[\da-f]{3}$/i.test(v) ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : v).toLowerCase();
const fontStack = (v) => (v ?? '').replace(/["'\s]/g, '').toLowerCase();

describe('look', () => {
  const siteCss = () => read(join(root, 'site', 'src', 'index.css'));
  const customCss = () => read(join(docsSite, '.vitepress', 'theme', 'custom.css'));
  const light = (css) => cssVars(css, (s) => !/dark/.test(s));
  const dark = (css) => cssVars(css, (s) => /dark/.test(s));

  test("the docs use the overview page's palette in light and dark", () => {
    for (const [mode, pick] of [['light', light], ['dark', dark]]) {
      const site = pick(siteCss());
      const docs = new Set(Object.values(pick(customCss())).map(hex));
      for (const name of PALETTE) {
        const value = site[`--color-${name}`];
        assert.ok(value, `site/src/index.css has no ${mode} --color-${name}`);
        assert.ok(docs.has(hex(value)), `custom.css has no ${mode} ${name} ${value}`);
      }
    }
  });

  test('the accent is #b80f0f light and #ff4d4d dark', () => {
    assert.equal(hex(light(customCss())['--vp-c-brand-1'] ?? ''), '#b80f0f');
    assert.equal(hex(dark(customCss())['--vp-c-brand-1'] ?? ''), '#ff4d4d');
  });

  test("the docs use the overview page's system font stack and VitePress's theme without fonts", () => {
    assert.equal(fontStack(light(customCss())['--vp-font-family-base']), fontStack(light(siteCss())['--font-sans']));
    const entry = read(join(docsSite, '.vitepress', 'theme', 'index.ts'));
    assert.match(entry, /from\s+['"]vitepress\/theme-without-fonts['"]/);
    assert.doesNotMatch(entry, /from\s+['"]vitepress\/theme['"]/);
  });

  test('the built docs bundle no web font', needsBuild, () => {
    const assets = join(built(), 'docs', 'assets');
    assert.deepEqual(readdirSync(assets, { recursive: true }).filter((f) => /\.(?:woff2?|ttf|otf)$/i.test(f)), []);
  });

  test('the built docs load nothing from another origin', needsBuild, () => {
    const dist = built();
    const external = /^(?:[a-z][\w+.-]*:)?\/\//i;
    for (const md of published()) {
      const html = read(join(dist, builtPageFor(dist, md)));
      const refs = [...html.matchAll(/<(?:script|link|img|iframe|source)\b[^>]*\b(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
      assert.deepEqual(refs.filter((r) => external.test(r)), [], `${md} loads from another origin`);
    }
    const assets = join(dist, 'docs', 'assets');
    for (const f of readdirSync(assets, { recursive: true }).filter((x) => x.endsWith('.css'))) {
      const css = read(join(assets, f));
      assert.doesNotMatch(css, /url\(\s*["']?(?:https?:)?\/\//, `${f} has an external url()`);
      assert.doesNotMatch(css, /@import\s+(?:url\()?["']?(?:https?:)?\/\//, `${f} has an external @import`);
    }
  });
});

// ---------------------------------------------------------------- the shared theme

function makeStorage(initial, blocked = false) {
  const store = new Map(Object.entries(initial));
  const guard = () => { if (blocked) { throw new Error('SecurityError: storage is blocked'); } };
  return {
    getItem: (k) => { guard(); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { guard(); store.set(k, String(v)); },
    removeItem: (k) => { guard(); store.delete(k); },
  };
}

function makeRootElement() {
  const classes = new Set();
  const attrs = new Map();
  return {
    classes,
    attrs,
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, force) => { const on = force ?? !classes.has(c); classes[on ? 'add' : 'delete'](c); return on; },
    },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    dataset: {},
    style: {},
  };
}

// A browser stub: `storage` is a storage object, or 'throws' when reading localStorage itself throws.
function makeBrowser(storage, prefersDark) {
  const docEl = makeRootElement();
  const listeners = [];
  const observers = [];
  const on = (type, fn) => { if (type === 'DOMContentLoaded' || type === 'load') { listeners.push(fn); } };
  const sandbox = {
    navigator: { platform: 'Linux' },
    document: { documentElement: docEl, addEventListener: on, readyState: 'loading', getElementById: () => null },
    matchMedia: () => ({ matches: prefersDark, addEventListener() {}, addListener() {} }),
    addEventListener: on,
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe(target) { observers.push({ cb: this.cb, target }); } disconnect() {} },
  };
  Object.defineProperty(sandbox, 'localStorage', {
    get: () => { if (storage === 'throws') { throw new Error('SecurityError: storage is blocked'); } return storage; },
  });
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return { sandbox, docEl, listeners, observers };
}

const inlineHeadScripts = (html) => [...headOf(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter((m) => !/\bsrc=/.test(m[1])).map((m) => m[2]);

// Runs a docs page's inline head scripts in order, as the browser does before first paint.
function loadDocs(rel, storage, prefersDark, { only } = {}) {
  const scripts = inlineHeadScripts(read(join(built(), rel))).filter((s) => !only || only(s));
  const browser = makeBrowser(storage, prefersDark);
  for (const s of scripts) { vm.runInContext(s, browser.sandbox); }
  const darkAtFirstPaint = browser.docEl.classes.has('dark');
  for (const fn of browser.listeners) { fn(); }
  // What VitePress's appearance toggle does on a click: store its own key and flip the class.
  const toggle = (isDark, { storeOwnKey = true } = {}) => {
    if (storeOwnKey) { storage.setItem(VP_KEY, isDark ? 'dark' : 'light'); }
    browser.docEl.classList.toggle('dark', isDark);
    for (const o of browser.observers.filter((x) => x.target === browser.docEl)) {
      o.cb([{ type: 'attributes', attributeName: 'class', target: browser.docEl }]);
    }
  };
  return { darkAtFirstPaint, toggle, docEl: browser.docEl };
}

const docsPages = () => published().map((md) => builtPageFor(built(), md));

describe('the theme shared with the overview page', needsBuild, () => {
  test('a stored dark opens every docs page dark before first paint, on a light system', () => {
    for (const rel of docsPages()) {
      assert.equal(loadDocs(rel, makeStorage({ [KEY]: 'dark' }), false).darkAtFirstPaint, true, rel);
      assert.equal(loadDocs(rel, makeStorage({ [KEY]: 'dark', [VP_KEY]: 'light' }), false).darkAtFirstPaint, true, `${rel}, stale docs choice`);
    }
  });

  test('a stored light opens every docs page light before first paint, on a dark system', () => {
    for (const rel of docsPages()) {
      assert.equal(loadDocs(rel, makeStorage({ [KEY]: 'light' }), true).darkAtFirstPaint, false, rel);
      assert.equal(loadDocs(rel, makeStorage({ [KEY]: 'light', [VP_KEY]: 'dark' }), true).darkAtFirstPaint, false, `${rel}, stale docs choice`);
    }
  });

  test('a missing or any other stored value means auto: the docs follow the system', () => {
    // Each stored value, alone and beside a stale VitePress choice that says the opposite of the system.
    const cases = [{}, ...OTHER_VALUES.map((v) => ({ [KEY]: v }))].flatMap((stored) => [
      [stored, true], [stored, false], [{ ...stored, [VP_KEY]: 'light' }, true], [{ ...stored, [VP_KEY]: 'dark' }, false],
    ]);
    for (const [stored, system] of cases) {
      const page = loadDocs('docs/index.html', makeStorage(stored), system);
      assert.equal(page.darkAtFirstPaint, system, `${JSON.stringify(stored)}, system dark ${system}`);
    }
  });

  test('toggling the docs theme writes light or dark to somi-theme, from a stored value or from auto', () => {
    for (const initial of [{ [KEY]: 'dark' }, {}, { [KEY]: 'sepia' }]) {
      const storage = makeStorage(initial);
      const page = loadDocs(builtPageFor(built(), 'hosts.md'), storage, true);
      page.toggle(false);
      assert.equal(storage.getItem(KEY), 'light', JSON.stringify(initial));
      page.toggle(true);
      assert.equal(storage.getItem(KEY), 'dark', JSON.stringify(initial));
    }
  });

  test('blocked storage changes nothing and throws nothing', () => {
    const own = (s) => s.includes(KEY);
    assert.ok(inlineHeadScripts(read(join(built(), 'docs', 'index.html'))).some(own), 'no head script reads somi-theme');
    const cases = [makeStorage({}, true), 'throws'].flatMap((storage) => [[storage, true], [storage, false]]);
    for (const [storage, system] of cases) {
      let page;
      assert.doesNotThrow(() => { page = loadDocs('docs/index.html', storage, system, { only: own }); });
      assert.deepEqual([...page.docEl.classes], [], 'the theme scripts changed the page');
      assert.deepEqual([...page.docEl.attrs], [], 'the theme scripts changed the page');
      assert.doesNotThrow(() => page.toggle(!system, { storeOwnKey: false }));
    }
  });
});

// ---------------------------------------------------------------- logo, favicon and nav

describe('logo, favicon and nav', needsBuild, () => {
  const mark = () => readFileSync(join(root, 'site', 'brand', 'somi-mark.svg'));
  const isMark = (dist, page, href) => {
    const file = servedFile(dist, new URL(decode(href), new URL(PAGES_BASE + page, ORIGIN)).pathname);
    return Boolean(file) && readFileSync(join(dist, file)).equals(mark());
  };

  test('the logo is somi-mark.svg and links to /somi/', () => {
    const dist = built();
    const page = builtPageFor(dist, 'hosts.md');
    const logoLinks = resolvedLinks(dist, page).filter((l) => /<img\b[^>]*class="[^"]*\blogo\b/.test(l.inner));
    assert.ok(logoLinks.length > 0, 'no linked logo image');
    for (const l of logoLinks) {
      assert.ok(isMark(dist, page, l.inner.match(/\bsrc="([^"]*)"/)[1]), 'the logo is not somi-mark.svg');
      assert.equal(l.url.origin + l.url.pathname, `${ORIGIN}${PAGES_BASE}`, 'the logo does not link to /somi/');
    }
  });

  test('the favicon is somi-mark.svg on every page', () => {
    const dist = built();
    for (const page of docsPages()) {
      const icons = [...read(join(dist, page)).matchAll(/<link\b[^>]*\brel="(?:shortcut )?icon"[^>]*>/g)].map((m) => m[0]);
      assert.ok(icons.some((l) => isMark(dist, page, l.match(/\bhref="([^"]*)"/)[1])), `${page}: the favicon is not somi-mark.svg`);
    }
  });

  test('every page has a "← SoMi" nav item to /somi/ and a GitHub link to the repo', () => {
    const dist = built();
    for (const page of docsPages()) {
      const links = resolvedLinks(dist, page);
      const back = links.filter((l) => text(l.inner) === '← SoMi');
      assert.ok(back.length > 0, `${page}: no "← SoMi" nav item`);
      for (const l of back) { assert.equal(l.url.origin + l.url.pathname, `${ORIGIN}${PAGES_BASE}`, `${page}: "← SoMi" does not go to /somi/`); }
      assert.ok(links.some((l) => l.href === REPO), `${page}: no link to ${REPO}`);
    }
  });
});
