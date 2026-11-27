// .github/pages.json is held to the schema in hashira's adoption guide (docs/flows/pages.md, section 3), so a bad value fails here,
// on the pull request, before hashira's docs build refuses it at deploy time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(REPO, rel));
const SITE = '.github/workflows/site.yml';
const PAGES = '.github/pages.json';

const pages = () => JSON.parse(read(PAGES));
const FIELDS = ['name', 'description', 'base', 'home_page', 'sidebar', 'unpublished', 'nav', 'home_link', 'accent', 'accent_dark', 'logo', 'theme_css'];
const textWithin = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max;
// A relative, normalized path with no way out of its root.
const cleanPath = (p) => typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !/[\\\0]/.test(p)
  && p.replace(/\/$/, '').split('/').every((s) => s !== '' && s !== '.' && s !== '..');
const HREF = /^(https:\/\/|http:\/\/|\/|\.\/|\.\.\/|#)/;
const goodLink = (l) => l && typeof l === 'object' && !Array.isArray(l)
  && Object.keys(l).every((k) => ['label', 'href'].includes(k))
  && textWithin(l.label, 1, 30) && typeof l.href === 'string' && HREF.test(l.href) && !/[\\\u0000-\u001f\u007f]/.test(l.href);

test('.github/pages.json exists, is a JSON object and at most 64 KB', () => {
  assert.ok(exists(PAGES), `${PAGES} exists`);
  assert.ok(fs.statSync(path.join(REPO, PAGES)).size <= 64 * 1024);
  const p = pages();
  assert.ok(p && typeof p === 'object' && !Array.isArray(p), 'a JSON object');
  for (const key of Object.keys(p)) assert.ok(FIELDS.includes(key), `unknown field ${key}`);
});

test('pages.json serves the docs at /somi/docs/', () => {
  const { base } = pages();
  // Left out, base defaults to /<repo>/docs/, which is /somi/docs/ here.
  if (base !== undefined) assert.equal(base, '/somi/docs/');
});

test('pages.json text fields are within their limits', () => {
  const p = pages();
  if ('name' in p) assert.ok(textWithin(p.name, 1, 40), 'name: 1 to 40 characters');
  if ('description' in p) assert.ok(textWithin(p.description, 0, 200), 'description: at most 200 characters');
  for (const field of ['accent', 'accent_dark']) if (field in p) assert.match(p[field], /^#([0-9a-f]{3}|[0-9a-f]{6})$/i, field);
});

test('pages.json home page is a Markdown page in docs/ with no docs/index.md beside it', () => {
  const { home_page: home = 'getting-started.md' } = pages();
  assert.ok(cleanPath(home) && home.endsWith('.md'), `home_page ${home}`);
  assert.ok(fs.statSync(path.join(REPO, 'docs', home)).isFile(), `docs/${home} exists`);
  assert.ok(!exists('docs/index.md'), 'docs/index.md would collide with the home page');
});

test('pages.json sidebar lists existing, published docs pages with short labels', () => {
  const { sidebar = [], unpublished = [] } = pages();
  assert.ok(Array.isArray(sidebar) && sidebar.length <= 100, 'sidebar: at most 100 entries');
  for (const [i, e] of sidebar.entries()) {
    assert.deepEqual(Object.keys(e).sort(), ['file', 'label'], `sidebar[${i}] holds file and label only`);
    assert.ok(cleanPath(e.file) && e.file.endsWith('.md'), `sidebar[${i}].file ${e.file}`);
    assert.ok(exists(`docs/${e.file}`), `docs/${e.file} exists`);
    assert.ok(textWithin(e.label, 1, 60), `sidebar[${i}].label: 1 to 60 characters`);
    assert.ok(!unpublished.includes(e.file), `${e.file} is not also unpublished`);
  }
});

test('pages.json unpublished is a short list of clean paths under docs/', () => {
  const { unpublished = [] } = pages();
  assert.ok(Array.isArray(unpublished) && unpublished.length <= 100, 'unpublished: at most 100 entries');
  for (const u of unpublished) assert.ok(cleanPath(u), `unpublished ${u}`);
});

test('pages.json header links use only the allowed schemes and limits', () => {
  const { nav = [], home_link: home } = pages();
  assert.ok(Array.isArray(nav) && nav.length <= 8, 'nav: at most 8 entries');
  for (const [i, l] of nav.entries()) assert.ok(goodLink(l), `nav[${i}] ${JSON.stringify(l)}`);
  if (home !== undefined) assert.ok(goodLink(home), `home_link ${JSON.stringify(home)}`);
});

test('pages.json logo and theme_css name files of the right kind in this repo', () => {
  const p = pages();
  for (const [field, ext] of [['logo', /\.(svg|png)$/], ['theme_css', /\.css$/]]) {
    if (!(field in p)) continue;
    assert.ok(cleanPath(p[field]) && ext.test(p[field]), `${field} ${p[field]}`);
    assert.ok(fs.statSync(path.join(REPO, p[field])).isFile(), `${p[field]} exists`);
  }
});

test('the new Pages config carries no local planning pointers', () => {
  for (const rel of [SITE, PAGES]) assert.doesNotMatch(read(rel), /\.somi\//, rel);
});
