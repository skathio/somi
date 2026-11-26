// Rules for linking the docs and wiring their build into CI, deploy and release: the overview
// page's header Docs link (visible at 390 px and 1440 px) and its footer benchmark link, the org
// homepage tile's Docs link within its limits, site.yml keeping its shape with only the `with:`
// literals changed, ci.yml's docs-site job, publish.yml's docs job that the publish job needs, and
// the changelog entry.
//
// The overview page is rendered from its own source through the site's Vite, the way its own
// tests render it, and skips when site/node_modules is missing. The workflows are read as text,
// by indentation, as rogue's suite reads them.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const docsSite = dirname(fileURLToPath(import.meta.url));
const root = join(docsSite, '..');
const site = join(root, 'site');
const OVERVIEW_URL = 'https://skathio.github.io/somi/';
const DOCS_URL = 'https://skathio.github.io/somi/docs/';
const SITE_YML = '.github/workflows/site.yml';
const CI_YML = '.github/workflows/ci.yml';
const PUBLISH_YML = '.github/workflows/publish.yml';
const BUILD_COMMAND = 'npm --prefix site ci --ignore-scripts && npm --prefix docs-site ci --ignore-scripts && docs-site/build.sh';
const SITE_TEST_COMMAND = 'npm --prefix site ci --ignore-scripts && npm --prefix site test';
const DOCS_TEST_SUFFIX = /^\s*&&\s*npm --prefix docs-site ci --ignore-scripts\s*&&\s*node --test docs-site\/\s*$/;
const VERSION = /\bv\d+(?:\.\d+)*\b/;
const PHONE = 390;
const DESKTOP = 1440;
const canRender = existsSync(join(site, 'node_modules', 'vite')) && existsSync(join(site, 'src', 'generated', 'facts.json'));
const needsSite = { skip: !canRender && 'needs `npm --prefix site ci --ignore-scripts` and the site facts (`npm --prefix site test` writes them)' };

const read = (rel) => readFileSync(join(root, rel), 'utf8');

function atHead(rel) {
  const shown = spawnSync('git', ['-C', root, 'show', `HEAD:${rel}`], { encoding: 'utf8' });
  assert.equal(shown.status, 0, `cannot read ${rel} at HEAD: ${shown.stderr}`);
  return shown.stdout;
}

// ---------------------------------------------------------------- YAML by indentation

const indentOf = (line) => line.match(/^ */)[0].length;
const isBlank = (line) => line.trim() === '' || line.trim().startsWith('#');
const meaningful = (lines) => (lines ?? []).filter((l) => !isBlank(l)).map((l) => l.replace(/\s+#.*$/, '').trimEnd());

// The line at `start` and the lines nested under it.
function blockAt(lines, start) {
  const out = [lines[start]];
  const depth = indentOf(lines[start]);
  for (let i = start + 1; i < lines.length; i++) {
    if (!isBlank(lines[i]) && indentOf(lines[i]) <= depth) { break; }
    out.push(lines[i]);
  }
  return out;
}

function block(lines, head) {
  const start = lines.findIndex((l) => head.test(l));
  return start < 0 ? null : blockAt(lines, start);
}

// Job name to its lines, for the jobs under the top-level `jobs:` key.
function jobsOf(text) {
  const jobs = new Map();
  const lines = block(text.split('\n'), /^jobs:\s*$/) ?? [];
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/^ {2}([\w-]+):\s*$/);
    if (m) { jobs.set(m[1], blockAt(lines, i)); }
  }
  return jobs;
}

function job(text, name) {
  const lines = jobsOf(text).get(name);
  assert.ok(lines, `no \`${name}\` job`);
  return lines;
}

// Each step of a job as its text, comments dropped.
function stepsOf(lines) {
  const start = lines.findIndex((l) => /^\s+steps:\s*$/.test(l));
  if (start < 0) { return []; }
  const itemIndent = indentOf(lines[start]) + 2;
  const steps = [];
  for (const line of meaningful(blockAt(lines, start).slice(1))) {
    if (/^\s*- /.test(line) && indentOf(line) === itemIndent) { steps.push(''); }
    if (steps.length) { steps[steps.length - 1] += `${line}\n`; }
  }
  return steps;
}

// The value of `key:` directly under the job (four spaces in), quotes dropped.
function jobKey(lines, key) {
  const line = lines.find((l) => new RegExp(`^ {4}${key}:`).test(l));
  return line ? line.replace(/^ {4}[\w-]+:\s*/, '').replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '').trim() : null;
}

function grants(lines) {
  const perms = block(lines, /^ {4}permissions:/);
  assert.ok(perms, 'the job declares no permissions');
  const inline = perms[0].replace(/^ {4}permissions:\s*/, '').replace(/\s+#.*$/, '').trim();
  if (inline) { return inline; }
  return Object.fromEntries(meaningful(perms.slice(1)).map((l) => l.trim().split(/:\s*/)));
}

const usesOf = (step) => step.match(/uses:\s*(\S+)/)?.[1] ?? null;
const commandsOf = (step) => step.split(/&&|\n|;/).map((c) => c.replace(/^\s*(?:-\s*)?(?:run:\s*\|?)?/, '').trim());
const isNpmCi = (command) => /^npm(?:\s+--prefix[ =]\S+)?\s+ci\b/.test(command) && /\s--ignore-scripts\b/.test(command);

// Whether a step runs `npm ci --ignore-scripts` in a folder, by --prefix or by working-directory.
function installs(step, dir) {
  const prefix = new RegExp(`--prefix[ =]['"]?(?:\\./)?${dir}/?['"]?(?:\\s|$)`);
  const cwd = new RegExp(`^\\s*working-directory:\\s*['"]?(?:\\./)?${dir}/?['"]?\\s*$`, 'm').test(step);
  return commandsOf(step).filter(isNpmCi).some((c) => prefix.test(c) || (cwd && !/--prefix/.test(c)));
}
const runsBuild = (step) => /\bdocs-site\/build\.sh\b/.test(step);
const runsDocsTests = (step) => /\bnode\s+--test\s+docs-site\/?(?:\s|$)/m.test(step);

function indexWhere(steps, pred, what) {
  const i = steps.findIndex(pred);
  assert.ok(i >= 0, `no step ${what}`);
  return i;
}

// Third-party actions are pinned by full commit SHA with a version comment; hashira tracks @v3.
function assertPinned(lines) {
  lines.forEach((line, i) => {
    const uses = line.match(/^\s*-?\s*uses:\s*(\S+)/)?.[1];
    if (!uses || uses.startsWith('./')) { return; }
    if (uses.startsWith('skathio/hashira/')) {
      assert.match(uses, /@v3$/, `${uses} must track hashira's v3 tag`);
      return;
    }
    assert.match(uses, /@[0-9a-f]{40}$/, `${uses} must be pinned by full commit SHA`);
    const comment = `${line.match(/\s#(.*)$/)?.[1] ?? ''} ${lines[i - 1]?.trim().startsWith('#') ? lines[i - 1] : ''}`;
    assert.match(comment, VERSION, `${uses} needs a version comment`);
  });
}

// A failing build fails the job: no continue-on-error and no swallowed exit status.
function assertFailureFails(lines) {
  assert.ok(!lines.some((l) => /^\s*continue-on-error:\s*(?!false)/.test(l)), 'the job must not continue on error');
  for (const step of stepsOf(lines)) {
    assert.doesNotMatch(step, /\|\|\s*(?:true|:|exit 0)\b|;\s*true\s*$|set \+e/m, `a step swallows a failure:\n${step}`);
  }
  assert.ok(!stepsOf(lines).some((s) => /\bnpm\s+(?:install|i)\b/.test(s)), 'installs use npm ci, not npm install');
}

// Node 24 from setup-node, both lockfiles installed with --ignore-scripts, then the docs build.
function assertDocsBuild(lines) {
  const steps = stepsOf(lines);
  const node = indexWhere(steps, (s) => /^actions\/setup-node@/.test(usesOf(s) ?? ''), 'uses actions/setup-node');
  assert.match(steps[node], /node-version:\s*['"]?24(?:\.[\dx*]+)*['"]?\s*$/m, 'setup-node must install Node 24');
  const site = indexWhere(steps, (s) => installs(s, 'site'), 'installs site/ with npm ci --ignore-scripts');
  const docs = indexWhere(steps, (s) => installs(s, 'docs-site'), 'installs docs-site/ with npm ci --ignore-scripts');
  const build = indexWhere(steps, runsBuild, 'runs docs-site/build.sh');
  assert.ok(node < site && node < docs, 'Node is set up before the installs');
  assert.ok(site < build && docs < build, 'both lockfiles are installed before the docs build');
  assertFailureFails(lines);
  assertPinned(lines);
  return steps;
}

const checkoutOf = (lines) => stepsOf(lines).find((s) => /^actions\/checkout@/.test(usesOf(s) ?? ''));

// ---------------------------------------------------------------- the overview page

// The overview page as the browser first gets it, rendered from App through the site's Vite.
async function renderOverview() {
  const req = createRequire(join(site, 'package.json'));
  const vite = await import(pathToFileURL(req.resolve('vite')).href);
  const server = await vite.createServer({
    root: site, configFile: join(site, 'vite.config.ts'), logLevel: 'silent', appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { App } = await server.ssrLoadModule('/src/App.tsx');
    return req('react-dom/server').renderToString(req('react').createElement(App));
  } finally {
    await server.close();
  }
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const textOf = (html) => html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();

// Each <a> with its attributes, its text and the attributes of its open ancestors.
function anchors(html) {
  const found = [];
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*?)(\/?)>/gi)) {
    const [, closing, name, attrs, selfClosing] = m;
    const tag = name.toLowerCase();
    if (closing) { stack.splice(stack.map((e) => e.tag).lastIndexOf(tag)); continue; }
    if (tag === 'a') {
      const end = html.indexOf('</a>', m.index);
      found.push({ attrs, text: textOf(html.slice(m.index + m[0].length, end)), ancestors: stack.map((e) => e.attrs) });
    }
    if (!selfClosing && !VOID.has(tag)) { stack.push({ tag, attrs }); }
  }
  return found;
}

const attr = (attrs, name) => attrs.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

function region(html, tag) {
  const m = html.match(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`));
  assert.ok(m, `the overview page has no <${tag}>`);
  return m[0];
}

// Tailwind's default breakpoints, in px.
const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };
const DISPLAY = /^(?:hidden|block|inline|inline-block|flex|inline-flex|grid|inline-grid|contents|table|flow-root|list-item)$/;

// The rank one variant gives a class at a width: its breakpoint for a min-width variant, just
// above the base for a max-width one, and null when it does not apply there or is not a breakpoint.
function variantRank(variant, width) {
  const max = variant.match(/^max-(.+)$/)?.[1];
  if (max !== undefined && max in BREAKPOINTS) { return width < BREAKPOINTS[max] ? 0.5 : null; }
  if (variant in BREAKPOINTS) { return width >= BREAKPOINTS[variant] ? BREAKPOINTS[variant] : null; }
  return null;
}

// The rank a class token applies with at a width, or null when it does not apply there. A token
// with a variant other than a breakpoint (hover:, dark:, print:, aria-*) is not counted.
function rankAt(variants, width) {
  const ranks = variants.map((v) => variantRank(v, width));
  return ranks.includes(null) ? null : Math.max(0, ...ranks);
}

// The class tokens that apply at a width, each as its utility and rank.
const classesAt = (attrs, width) => (attr(attrs, 'class') ?? '').split(/\s+/).filter(Boolean)
  .map((token) => { const parts = token.split(':'); const utility = parts.pop(); return { utility, rank: rankAt(parts, width) }; })
  .filter((c) => c.rank !== null);

const hiddenByAttrs = (attrs) => /\shidden(?:\s|$)/.test(attrs.replace(/="[^"]*"/g, ''))
  || /display\s*:\s*none|visibility\s*:\s*hidden/.test(attr(attrs, 'style') ?? '');

// Whether an element's attributes or classes hide it at a width; the display class with the
// highest breakpoint wins, as Tailwind orders them.
function hiddenAt(attrs, width) {
  const classes = classesAt(attrs, width);
  if (hiddenByAttrs(attrs) || classes.some((c) => /^(?:invisible|sr-only|opacity-0)$/.test(c.utility))) { return true; }
  const display = classes.filter((c) => DISPLAY.test(c.utility)).reduce((won, c) => (c.rank >= won.rank ? c : won), { rank: -1 });
  return display.utility === 'hidden';
}

describe('the overview page links the docs', () => {
  const page = { html: null };
  const overview = async () => { page.html ??= await renderOverview(); return page.html; };

  function headerDocsLink(html) {
    const links = anchors(region(html, 'header')).filter((a) => a.text === 'Docs');
    assert.equal(links.length, 1, 'the header has no single "Docs" link');
    return links[0];
  }

  test('the header has a "Docs" link to /somi/docs/', needsSite, async () => {
    const href = attr(headerDocsLink(await overview()).attrs, 'href');
    assert.ok(href, 'the header "Docs" link has no href');
    const url = new URL(href, OVERVIEW_URL);
    assert.equal(url.href.replace(/[?#].*$/, ''), DOCS_URL, `the header "Docs" link goes to ${href}`);
  });

  for (const width of [PHONE, DESKTOP]) {
    test(`no class hides the header Docs link or what holds it at ${width} px`, needsSite, async () => {
      const link = headerDocsLink(await overview());
      for (const attrs of [...link.ancestors, link.attrs]) {
        assert.ok(!hiddenAt(attrs, width), `hidden at ${width} px by <…${attrs}>`);
      }
    });
  }

  test('the visibility check sees a link hidden on a phone and one hidden on a desktop', () => {
    assert.ok(hiddenAt(' class="hidden sm:inline-block"', PHONE));
    assert.ok(!hiddenAt(' class="hidden sm:inline-block"', DESKTOP));
    assert.ok(hiddenAt(' class="block lg:hidden"', DESKTOP));
    assert.ok(!hiddenAt(' class="block lg:hidden"', PHONE));
    assert.ok(hiddenAt(' class="max-sm:hidden"', PHONE));
    assert.ok(!hiddenAt(' class="px-2 hover:hidden print:hidden"', PHONE));
    assert.ok(hiddenAt(' class="px-2" hidden=""', DESKTOP));
    assert.ok(hiddenAt(' style="display: none"', DESKTOP));
  });

  test("the footer's \"Usage benchmark\" link opens the docs site's benchmark page", needsSite, async () => {
    const links = anchors(region(await overview(), 'footer')).filter((a) => a.text === 'Usage benchmark');
    assert.equal(links.length, 1, 'the footer has no single "Usage benchmark" link');
    const href = attr(links[0].attrs, 'href');
    const url = new URL(href ?? '', OVERVIEW_URL);
    assert.equal(url.origin, new URL(DOCS_URL).origin, `"Usage benchmark" leaves the Pages site: ${href}`);
    assert.match(url.pathname, /^\/somi\/docs\/BENCHMARK(?:\.html)?$/, `"Usage benchmark" goes to ${href}`);
  });
});

// ---------------------------------------------------------------- the org homepage tile

describe('.github/homepage.json', () => {
  const manifest = JSON.parse(read('.github/homepage.json'));
  const links = Object.entries(manifest.links ?? {});

  test('the tile links Docs to the docs site, at the base the docs are built for', () => {
    assert.equal(manifest.links?.Docs, DOCS_URL);
    const base = read('docs-site/.vitepress/config.mts').match(/^\s*base:\s*['"]([^'"]+)['"]/m);
    assert.ok(base, 'no base in docs-site/.vitepress/config.mts');
    assert.equal(manifest.links.Docs, `https://skathio.github.io${base[1]}`);
  });

  test('the tile has at least one and at most 4 links', () => {
    assert.ok(links.length >= 1, 'the tile has no links');
    assert.ok(links.length <= 4, `${links.length} links, past the limit of 4`);
  });

  test('every tile link is an https URL', () => {
    for (const [label, url] of links) {
      assert.equal(typeof url, 'string', `${label} is not a URL string`);
      assert.equal(new URL(url).protocol, 'https:', `${label}: ${url}`);
    }
  });
});

// ---------------------------------------------------------------- site.yml

// The `with:` value of the build job for a key, quotes dropped.
function withValue(text, key) {
  const lines = block(job(text, 'build'), /^ {4}with:\s*$/) ?? [];
  const line = lines.find((l) => new RegExp(`^ {6}${key}:`).test(l));
  if (!line) { return null; }
  const raw = line.replace(/^ {6}[\w-]+:\s*/, '').replace(/\s+#.*$/, '').trim();
  return raw.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
}

// The file with comments and the values of the `with:` literals that may change blanked.
const shapeOf = (text) => meaningful(text.split('\n')).map((l) => l.replace(/^( {6}(?:build_command|test_command):).*$/, '$1'));

describe('site.yml', () => {
  const now = read(SITE_YML);

  test('apart from comments and the build and test literals, the file is as it was at HEAD', () => {
    assert.deepEqual(shapeOf(now), shapeOf(atHead(SITE_YML)));
  });

  test('the jobs are gate, then build on hashira static-webapp-ci@v3, then deploy', () => {
    assert.deepEqual([...jobsOf(now).keys()], ['gate', 'build', 'deploy']);
    assert.equal(jobKey(job(now, 'build'), 'uses'), 'skathio/hashira/.github/workflows/static-webapp-ci.yml@v3');
    assert.equal(jobKey(job(now, 'build'), 'needs'), 'gate');
    assert.equal(jobKey(job(now, 'deploy'), 'needs'), 'build');
    assert.match(job(now, 'gate').join('\n'), /^ {4}environment:\s*production\s*$/m, 'gate keeps the production approval');
  });

  test('the permissions are unchanged: none at the top, the static-webapp-ci matrix, then deploy-pages', () => {
    assert.match(now, /^permissions:\s*\{\}\s*$/m);
    assert.equal(grants(job(now, 'gate')), '{}');
    assert.deepEqual(grants(job(now, 'build')), {
      contents: 'read', 'id-token': 'write', pages: 'write', 'pull-requests': 'write', 'security-events': 'write',
    });
    assert.deepEqual(grants(job(now, 'deploy')), { pages: 'write', 'id-token': 'write' });
  });

  test('the triggers are a manual run and the release call, never a push', () => {
    const on = meaningful(block(now.split('\n'), /^on:\s*$/));
    const triggers = on.filter((l) => /^ {2}[\w-]+:/.test(l)).map((l) => l.trim().replace(/:.*$/, ''));
    assert.deepEqual(triggers, ['workflow_dispatch', 'workflow_call']);
  });

  test('build_command installs both lockfiles and runs docs-site/build.sh', () => {
    assert.equal(withValue(now, 'build_command'), BUILD_COMMAND);
  });

  test('output_dir is still site/dist', () => {
    assert.equal(withValue(now, 'output_dir'), 'site/dist');
  });

  test("test_command runs the site's tests, then installs docs-site and runs its tests", () => {
    const command = withValue(now, 'test_command') ?? '';
    assert.ok(command.startsWith(SITE_TEST_COMMAND), `test_command no longer starts with the site's tests: ${command}`);
    assert.match(command.slice(SITE_TEST_COMMAND.length), DOCS_TEST_SUFFIX);
  });

  test('the header comment says the docs are built into site/dist/docs', () => {
    const header = now.split('\n').slice(0, now.split('\n').findIndex((l) => /^name:/.test(l)));
    assert.ok(header.every((l) => isBlank(l)), 'the header is not a comment');
    assert.match(header.join('\n'), /site\/dist\/docs\b/);
  });
});

// ---------------------------------------------------------------- ci.yml

describe('ci.yml docs-site job', () => {
  const now = read(CI_YML);

  test('it reads the repo and nothing more', () => {
    assert.deepEqual(grants(job(now, 'docs-site')), { contents: 'read' });
  });

  test('its checkout keeps no credentials', () => {
    const checkout = checkoutOf(job(now, 'docs-site'));
    assert.ok(checkout, 'the docs-site job does not check out the repo');
    assert.match(checkout, /persist-credentials:\s*false\s*$/m);
  });

  test('on Node 24 it installs both lockfiles with --ignore-scripts and runs docs-site/build.sh', () => {
    assertDocsBuild(job(now, 'docs-site'));
  });

  test('it runs node --test docs-site/ after both installs', () => {
    const steps = stepsOf(job(now, 'docs-site'));
    const tests = indexWhere(steps, runsDocsTests, 'runs node --test docs-site/');
    assert.ok(steps.findIndex((s) => installs(s, 'docs-site')) < tests, 'docs-site/ is installed before its tests');
    assert.ok(steps.findIndex((s) => installs(s, 'site')) < tests, 'site/ is installed before the docs tests');
  });

  test('it runs on every pull request, with no condition that skips it', () => {
    const on = meaningful(block(now.split('\n'), /^on:\s*$/)).join('\n');
    assert.match(on, /^\s+pull_request:/m);
    assert.doesNotMatch(on, /paths(?:-ignore)?:/, 'the pull_request trigger must not filter by path');
    assert.equal(jobKey(job(now, 'docs-site'), 'if'), null);
  });

  test('the site job is as it was at HEAD', () => {
    assert.deepEqual(meaningful(job(now, 'site')), meaningful(job(atHead(CI_YML), 'site')));
  });
});

// ---------------------------------------------------------------- publish.yml

describe('publish.yml docs job', () => {
  const now = read(PUBLISH_YML);
  const needsOf = (name) => (jobKey(job(now, name), 'needs') ?? '').replace(/^\[|\]$/g, '').split(',').map((n) => n.trim()).filter(Boolean);

  test('publish needs the docs job, and still the version job', () => {
    const needs = needsOf('publish');
    assert.ok(needs.includes('docs'), `publish needs ${needs.join(', ')}`);
    assert.ok(needs.includes('version'), `publish needs ${needs.join(', ')}`);
  });

  test('it runs the docs build: Node 24, both lockfiles with --ignore-scripts, docs-site/build.sh', () => {
    assertDocsBuild(job(now, 'docs'));
  });

  test('it builds the release commit, the one publish checks out', () => {
    const refOf = (name) => {
      const checkout = checkoutOf(job(now, name));
      assert.ok(checkout, `the ${name} job does not check out the repo`);
      return checkout.match(/^\s+ref:\s*(.+)$/m)?.[1] ?? null;
    };
    assert.equal(refOf('docs'), refOf('publish'));
  });

  test('it grants nothing beyond reading the repo', () => {
    const granted = grants(job(now, 'docs'));
    if (granted === '{}') { return; }
    for (const [scope, level] of Object.entries(granted)) {
      assert.ok(scope === 'contents' && level === 'read', `the docs job grants ${scope}: ${level}`);
    }
  });
});

// ---------------------------------------------------------------- the changelog

describe('CHANGELOG.md', () => {
  const unreleased = () => {
    const text = read('CHANGELOG.md');
    const start = text.indexOf('## [Unreleased]');
    assert.ok(start >= 0, 'no [Unreleased] section');
    const next = text.indexOf('\n## [', start + 1);
    return text.slice(start, next < 0 ? text.length : next);
  };

  const addedEntries = () => {
    const section = unreleased();
    const start = section.indexOf('\n### Added\n');
    assert.ok(start >= 0, '[Unreleased] has no ### Added');
    const next = section.indexOf('\n### ', start + 1);
    return section.slice(start, next < 0 ? section.length : next).split('\n').filter((l) => l.startsWith('- '));
  };

  test('[Unreleased] → ### Added has a bold-titled entry for the docs site', () => {
    const entries = addedEntries().filter((l) => /docs site|skathio\.github\.io\/somi\/docs/i.test(l));
    assert.equal(entries.length >= 1, true, 'no ### Added entry names the docs site');
    for (const entry of entries) { assert.match(entry, /^- \*\*[^*]+\*\* \S/, `not in the file's style: ${entry}`); }
  });

  test('### Added comes before ### Changed, as in the released sections', () => {
    const section = unreleased();
    const changed = section.indexOf('\n### Changed\n');
    if (changed >= 0) { assert.ok(section.indexOf('\n### Added\n') < changed, '### Added is after ### Changed'); }
  });

  test('the entry carries no pointer into .somi/', () => {
    for (const entry of addedEntries()) { assert.doesNotMatch(entry, /\.somi\//); }
  });
});
