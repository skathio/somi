// The docs header and the overview page's header show the same links. hashira's docs-build writes the docs
// header from pages.json's `nav`, in <site-nav>'s order, and resolves each href against the landing; its adoption
// guide has the landing give <site-nav> the same nav as pages.json. The page's links are NAV in site/src/App.tsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const pages = () => JSON.parse(read('.github/pages.json'));

// The page header's links as Header.tsx gives them to <site-nav>: { label, href: '#id' } for each NAV entry.
function pageNav() {
  const block = /export const NAV: NavItem\[\] = \[([\s\S]*?)\n\];/.exec(read('site/src/App.tsx'));
  assert.ok(block, 'site/src/App.tsx exports NAV');
  return [...block[1].matchAll(/\{\s*id:\s*'([^']*)',\s*label:\s*'([^']*)'\s*\}/g)].map((m) => ({ label: m[2], href: `#${m[1]}` }));
}

test('the page header has section links to compare', () => {
  assert.ok(pageNav().length > 0, 'NAV entries were read from site/src/App.tsx');
});

test('pages.json nav lists the same section links as the page header, in the same order', () => {
  assert.deepEqual(pages().nav, pageNav());
});

test('each docs header link opens a section of the page, which the docs resolve against the landing', () => {
  const { nav } = pages();
  assert.ok(nav.length > 0 && nav.length <= 8, 'between 1 and 8 links');
  for (const { label, href } of nav) {
    assert.match(href, /^#[a-z][\w-]*$/, label);
    assert.ok([...label].length >= 1 && [...label].length <= 30, `${label}: 1 to 30 characters`);
  }
});

// Seven section links and Docs do not fit beside the docs search box on a mid-width screen: the bar would push
// its last controls off the page. The docs theme leaves the section links out there and keeps Docs.
test('the docs theme leaves the section links out of the bar where they would not fit, and keeps Docs', () => {
  const css = read(pages().theme_css);
  const rule = /@media\s*\(min-width:\s*768px\)\s*and\s*\(max-width:\s*(\d+)px\)\s*\{\s*([^{}]+)\{\s*display:\s*none;?\s*\}/.exec(css);
  assert.ok(rule, `a width rule in ${pages().theme_css}`);
  assert.ok(Number(rule[1]) >= 1139 && Number(rule[1]) < 1280, `max-width ${rule[1]}px`);
  // A section link carries a #fragment; the Docs link, the docs base, does not.
  assert.equal(rule[2].trim(), '.VPNavBarMenu .VPNavBarMenuLink[href*="#"]');
  assert.doesNotMatch(pages().base, /#/);
});

test('the release guide describes the page deploy as it runs now, through pages-site', () => {
  const guide = read('docs/VERSIONING.md');
  assert.match(guide, /pages-site/);
  assert.doesNotMatch(guide, /static-webapp-ci|pages-deploy/);
});
