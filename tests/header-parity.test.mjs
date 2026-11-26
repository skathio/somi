// The overview page's header matches the other skathio project sites (hashira, rogue): the same link back to
// the skathio homepage before the theme toggle, and the kit's accent taken from the page's own colours.
// These read the sources from disk: the site's own tests import CSS through Vite, which hands them an empty string.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const pages = () => JSON.parse(read('.github/pages.json'));
const HOME = { label: '← skathio', href: 'https://skathio.github.io/' };

function sourceFiles(dir) {
  return fs.readdirSync(path.join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx|css|html)$/.test(e.name) ? [rel] : [];
  });
}

test('pages.json links back to the skathio homepage, as the other project sites do', () => {
  assert.deepEqual(pages().home_link, HOME);
});

test('the page header gives <site-nav> the home link from pages.json, not a second copy of it', () => {
  const header = read('site/src/components/Header.tsx');
  assert.match(header, /<site-nav\b[^>]*\shome_link=\{/, 'a home_link attribute on <site-nav>');
  assert.match(header, /from '[./]+\/\.github\/pages\.json'/, 'read from .github/pages.json');
  assert.doesNotMatch(header, /skathio\.github\.io/, 'no hard-coded homepage address');
});

test('the home link opens the homepage on this origin over https', () => {
  const url = new URL(pages().home_link.href);
  assert.equal(url.origin, 'https://skathio.github.io');
  assert.equal(url.pathname, '/');
});

// The kit's accent is --site-accent (light) and --site-accent-dark, set in index.html; the page's own is
// --color-accent in index.css, first for light and then inside the dark block.
test('the kit accent is the page accent, in light and in dark', () => {
  const css = read('site/src/index.css');
  assert.ok(css.length > 0, 'site/src/index.css was read');
  const page = [...css.matchAll(/--color-accent:\s*(#[0-9a-f]{6});/gi)].map((m) => m[1].toLowerCase());
  assert.ok(page.length >= 2, 'a light and a dark --color-accent');
  const html = read('site/index.html');
  const kit = (name) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})\\s*[;}]`, 'i').exec(html)?.[1].toLowerCase();
  assert.equal(kit('--site-accent'), page[0]);
  assert.equal(kit('--site-accent-dark'), page[1]);
  for (const a of [page[0], page[1]]) assert.doesNotMatch(a, /^#(1e7d69|4fd1b5)$/, 'never the kit default green');
});

test('no source of the page keeps a theme store of its own beside the kit key', () => {
  const files = ['site/index.html', ...sourceFiles('site/src')];
  assert.ok(files.some((f) => f.endsWith('.css')) && files.some((f) => f.endsWith('.tsx')), 'CSS and TSX sources were found');
  for (const file of files) {
    const text = read(file);
    assert.ok(text.length > 0, `${file} was read`);
    assert.doesNotMatch(text, /somi-theme|localStorage/, file);
  }
});

// The docs bar holds the section links, Docs and the home link from the width where the section links come
// back. Measured in a browser against a local docs build, at VitePress's own spacing they run past the edge
// of the page from there to about 1310px, so the docs theme sets them closer together across that range.
test('the docs theme tightens the header links from where the section links show until they fit', () => {
  const css = read(pages().theme_css);
  const hidden = /@media\s*\(min-width:\s*768px\)\s*and\s*\(max-width:\s*(\d+)px\)/.exec(css);
  assert.ok(hidden, 'the rule that leaves the section links out');
  const tight = /@media\s*\(min-width:\s*(\d+)px\)\s*and\s*\(max-width:\s*(\d+)px\)\s*\{\s*\.VPNavBarMenu \.VPNavBarMenuLink\s*\{\s*padding:\s*0\s+(\d+)px;?\s*\}/.exec(css);
  assert.ok(tight, 'a padding rule for the header links');
  assert.equal(Number(tight[1]), Number(hidden[1]) + 1, 'starts where the section links come back');
  assert.ok(Number(tight[2]) >= 1310, `reaches ${tight[2]}px`);
  assert.ok(Number(tight[3]) >= 4 && Number(tight[3]) <= 7, `${tight[3]}px a side: close enough to fit, still apart`);
});
