import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs build script without type declarations
import { checkBuiltCss, checkBuiltHtml } from '../scripts/check-dist.mjs';

const ICON = '<link rel="icon" href="/somi/favicon-32.png">';
const page = (head: string) => `<!doctype html><html><head><title>T</title>${ICON}${head}</head><body></body></html>`;
const has = (...files: string[]) => (rel: string) => files.includes(rel);

describe('checkBuiltHtml', () => {
  it('passes a page whose assets are emitted under the base path', () => {
    const html = page('<script type="module" src="/somi/assets/index.js"></script><link rel="stylesheet" href="/somi/assets/index.css">');
    expect(checkBuiltHtml(html, has('favicon-32.png', 'assets/index.js', 'assets/index.css'))).toEqual([]);
  });
  it('refuses anything from another origin', () => {
    expect(checkBuiltHtml(page('<script src="https://cdn.example/x.js"></script>'), has()).join()).toMatch(/outside \/somi\//);
    expect(checkBuiltHtml(page('<link rel="stylesheet" href="https://fonts.example/a.css">'), has()).join()).toMatch(/outside/);
    expect(checkBuiltHtml(page('<img src="//img.example/a.png">'), has()).join()).toMatch(/outside/);
  });
  it('refuses a reference to an asset that was not emitted', () => {
    expect(checkBuiltHtml(page('<script src="/somi/assets/gone.js"></script>'), has()).join()).toMatch(/not emitted/);
  });
  it('requires a title and a favicon', () => {
    const got = checkBuiltHtml('<html><head></head></html>', has());
    expect(got).toContain('missing <title>');
    expect(got.join()).toMatch(/missing favicon/);
  });
  it('requires the link-preview image to be an emitted file on the site', () => {
    const og = (url: string) => page(`<meta property="og:image" content="${url}">`);
    expect(checkBuiltHtml(og('https://skathio.github.io/somi/icon-512.png'), has('favicon-32.png', 'icon-512.png'))).toEqual([]);
    expect(checkBuiltHtml(og('https://skathio.github.io/somi/gone.png'), has('favicon-32.png')).join()).toMatch(/og:image not emitted/);
    expect(checkBuiltHtml(og('https://cdn.example/x.png'), has('favicon-32.png')).join()).toMatch(/og:image outside/);
  });
});

describe('checkBuiltCss', () => {
  it('allows same-site and data urls', () => {
    expect(checkBuiltCss('a{background:url(/somi/assets/x.svg)}b{background:url("data:image/png;base64,AA")}')).toEqual([]);
  });
  it('refuses external urls and imports', () => {
    expect(checkBuiltCss('a{background:url(https://x.example/a.png)}').join()).toMatch(/external url/);
    expect(checkBuiltCss('@import url("https://fonts.example/a.css");').join()).toMatch(/external @import/);
  });
});
