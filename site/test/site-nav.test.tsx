import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App, NAV } from '../src/App';
// @ts-expect-error -- a plain .mjs build script without type declarations
import { checkBuiltHtml } from '../scripts/check-dist.mjs';
import pagesJson from '../../.github/pages.json';
import indexHtml from '../index.html?raw';
import indexCss from '../src/index.css?raw';

// The header is hashira's shared <site-nav> (site-kit), so somi's landing has the same nav as the other skathio
// sites: the kit renders brand, nav links, Docs, the extras slot, home_link and the theme toggle; the page fills in
// its own items and puts Present in the extras slot (the element's children).

const SITE = 'https://skathio.github.io/somi/';
// home_link is optional in pages.json; somi's sets it, the link back to the skathio homepage.
const pages: { name?: string; base?: string; home_link?: unknown } = pagesJson;
const sources = import.meta.glob<string>('../src/**/*.{ts,tsx,css}', { query: '?raw', import: 'default', eager: true });
// Files the build would publish from public/ as they are.
const published = Object.keys(import.meta.glob('../public/**/*', { query: '?url', eager: true }));
const html = renderToString(<App />);

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function siteNavs(page: string) {
  return [...page.matchAll(/<site-nav\b([^>]*)>([\s\S]*?)<\/site-nav>/g)].map((m) => ({
    attrs: Object.fromEntries([...m[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((a) => [a[1], decode(a[2] ?? '')])),
    inner: m[2],
  }));
}

const navs = siteNavs(html);
const nav = navs[0] ?? { attrs: {} as Record<string, string>, inner: '' };

// What the kit reads: the inline JSON child, then attributes of the same names, which win (nav and home_link as JSON).
function config() {
  const script = /^\s*<script type="application\/json">([\s\S]*?)<\/script>/.exec(nav.inner);
  const out: Record<string, unknown> = script ? JSON.parse(script[1]) : {};
  for (const [k, v] of Object.entries(nav.attrs)) out[k] = k === 'nav' || k === 'home_link' ? JSON.parse(v) : v;
  return out;
}

// The element's own children apart from the JSON child: what the kit shows in its extras slot.
const extras = () => nav.inner.replace(/^\s*<script type="application\/json">[\s\S]*?<\/script>/, '');

describe('the header', () => {
  it('is one <site-nav>', () => {
    expect(navs).toHaveLength(1);
  });

  it('gives the kit the same name as pages.json for the brand, with a logo from this site', () => {
    const c = config();
    expect(c.name).toBe(pages.name);
    expect(typeof c.logo).toBe('string');
    expect(c.logo).not.toBe('');
    expect(new URL(String(c.logo), SITE).href.startsWith(SITE)).toBe(true);
  });

  it('has the brand link to the site root, so /somi/ is unchanged', () => {
    const root = new URL(String(config().root ?? './'), SITE);
    expect(root.origin + root.pathname).toBe(SITE);
  });

  it('links Docs through the kit, to where pages.json serves the docs', () => {
    const docs = config().docs;
    expect(docs, 'the docs attribute').toBeDefined();
    const href = docs === true || docs === '' ? 'docs/' : String(docs);
    expect(new URL(href, SITE).href).toBe(`https://skathio.github.io${pages.base ?? '/somi/docs/'}`);
  });

  it('lists every section of the page as a nav link', () => {
    const items = config().nav as { label: string; href: string }[];
    expect(Array.isArray(items)).toBe(true);
    for (const { id, label } of NAV) expect(items, id).toContainEqual({ label, href: `#${id}` });
  });

  it('shows the same home_link as pages.json', () => {
    expect(config().home_link ?? null).toEqual(pages.home_link ?? null);
  });

  it('turns on the kit scroll highlight for the section in view', () => {
    expect(nav.attrs).toHaveProperty('scrollspy');
  });

  it('puts Present in the extras slot', () => {
    expect(extras()).toMatch(/<button\b[^>]*>[\s\S]*?Present[\s\S]*?<\/button>/);
  });

  it('leaves the brand, the nav links, Docs and the theme toggle to the kit, so the order is the shared one', () => {
    const slot = extras();
    expect(slot).not.toMatch(/<a\b[^>]*>[\s\S]*?Docs[\s\S]*?<\/a>/);
    expect(slot).not.toMatch(/\bhref="(\/somi\/docs\/|docs\/)"/);
    expect(slot).not.toMatch(/[Tt]heme/);
    for (const { id } of NAV) expect(slot, id).not.toContain(`href="#${id}"`);
    // Outside the element, no second header nav repeats the sections.
    const outside = html.replace(/<site-nav\b[\s\S]*?<\/site-nav>/, '');
    expect(/<nav\b[^>]*aria-label="Sections"/.test(outside), 'a hand-made Sections nav beside <site-nav>').toBe(false);
  });

  it('uses somi accent, never the kit default green', () => {
    const accents = [
      config().accent,
      ...[...indexCss.matchAll(/--site-accent(?:-dark)?\s*:\s*([^;]+);/g)].map((m) => m[1].trim()),
      ...[...indexHtml.matchAll(/--site-accent(?:-dark)?\s*:\s*([^;"]+)/g)].map((m) => m[1].trim()),
    ].filter((a): a is string => typeof a === 'string' && a !== '');
    expect(accents.length, 'an accent for the kit (accent, or --site-accent)').toBeGreaterThan(0);
    for (const a of accents) expect(a.toLowerCase()).not.toMatch(/^#(1e7d69|4fd1b5)$/);
  });
});

describe('index.html', () => {
  const page = indexHtml;
  const head = page.slice(0, page.indexOf('</head>'));
  const kit = (file: string) => `${SITE}_kit/${file}`;
  const resolves = (ref: string) => new URL(ref, SITE).href;

  it('loads the kit stylesheet', () => {
    const links = [...head.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((t) => /\srel="stylesheet"/.test(t));
    expect(links.map((t) => resolves(/\shref="([^"]*)"/.exec(t)?.[1] ?? ''))).toContain(kit('tokens.css'));
  });

  it('loads theme.js in <head> as a plain script, so the stored theme applies before first paint', () => {
    const tag = [...head.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]).find((t) => resolves(/\ssrc="([^"]*)"/.exec(t)?.[1] ?? '#') === kit('theme.js'));
    expect(tag, 'theme.js in <head>').toBeDefined();
    expect(tag).not.toMatch(/\s(defer|async)\b|type="module"/);
  });

  it('loads site-nav.js deferred', () => {
    const tag = [...page.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]).find((t) => resolves(/\ssrc="([^"]*)"/.exec(t)?.[1] ?? '#') === kit('site-nav.js'));
    expect(tag, 'site-nav.js').toBeDefined();
    expect(tag).toMatch(/\sdefer\b/);
  });
});

describe('the theme', () => {
  it('has one store, the kit theme key, so landing and docs open in the same theme', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(0);
    for (const [file, text] of Object.entries(sources)) expect(text.includes('somi-theme'), file).toBe(false);
  });

  it('names the old somi-theme key in index.html only to move it to the kit key and remove it', () => {
    const scripts = [...indexHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const old = scripts.filter((s) => s.includes('somi-theme'));
    expect(old).toHaveLength(1);
    expect(old[0]).toMatch(/localStorage\.setItem\('theme'/);
    expect(old[0]).toMatch(/localStorage\.removeItem\('somi-theme'\)/);
    expect(indexHtml.replace(old[0], '')).not.toContain('somi-theme');
  });
});

describe('the site folder', () => {
  it('holds no _kit or docs folder of its own, which the pages build refuses to write over', () => {
    expect(published.length, 'public/ is globbed').toBeGreaterThan(0);
    for (const file of published) expect(file).not.toMatch(/^\.\.\/public\/(_kit|docs)\//);
  });
});

describe('checkBuiltHtml and the kit', () => {
  const ICON = '<link rel="icon" href="/somi/favicon-32.png">';
  const built = (head: string) => `<!doctype html><html><head><title>T</title>${ICON}${head}</head><body></body></html>`;
  const has = (...files: string[]) => (rel: string) => files.includes(rel);
  const KIT =
    '<link rel="stylesheet" href="/somi/_kit/tokens.css"><script src="/somi/_kit/theme.js"></script><script src="/somi/_kit/site-nav.js" defer></script>';

  it('passes kit files the pages build copies in after the Vite build', () => {
    expect(checkBuiltHtml(built(KIT), has('favicon-32.png'))).toEqual([]);
  });

  it('passes a page with no kit reference', () => {
    expect(checkBuiltHtml(built(''), has('favicon-32.png'))).toEqual([]);
  });

  it('still refuses a missing asset outside the kit, also when the path climbs out of _kit', () => {
    expect(checkBuiltHtml(built(`${KIT}<script src="/somi/assets/gone.js"></script>`), has('favicon-32.png')).join()).toMatch(/not emitted/);
    expect(checkBuiltHtml(built('<script src="/somi/_kit/../assets/gone.js"></script>'), has('favicon-32.png')).join()).toMatch(/not emitted|outside/);
  });

  it('still refuses a kit file from another origin', () => {
    expect(checkBuiltHtml(built('<script src="https://cdn.example/somi/_kit/theme.js"></script>'), has('favicon-32.png')).join()).toMatch(/outside \/somi\//);
    expect(checkBuiltHtml(built('<link rel="stylesheet" href="//cdn.example/_kit/tokens.css">'), has('favicon-32.png')).join()).toMatch(/outside/);
  });
});
