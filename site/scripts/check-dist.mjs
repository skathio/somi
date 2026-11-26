// check-dist.mjs -- the last step of `npm run build`: the built page loads nothing from another origin
// (no CDN script, stylesheet, font or image, so it renders on a presenting device with no network beyond
// GitHub Pages), every asset it references was emitted, and the branding is wired: a favicon, and a
// link-preview image that exists on the site.
//
// Usage: node scripts/check-dist.mjs [--kit] [distDir]   (default: dist)
//   --kit: the dist has had hashira's site kit copied in, so the kit files must exist like any other asset.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = '/somi/';
const SITE = `https://skathio.github.io${BASE}`;
// hashira's site kit: the pages build copies these into dist/_kit/ after this check has run, so they are
// not there yet, unless the check runs with `kit` on a dist the kit was copied into. Exact paths only, so a
// ref that climbs out of _kit/ is still checked like any other.
const KIT = new Set(['_kit/tokens.css', '_kit/theme.js', '_kit/site-nav.js']);

/** -> problems with a built index.html, given a way to test whether an emitted file exists. */
export function checkBuiltHtml(html, exists, { kit = false } = {}) {
  const problems = [];
  if (!/<title>[^<]+<\/title>/.test(html)) problems.push('missing <title>');
  if (!/<link\b[^>]*\srel="icon"/.test(html)) problems.push('missing favicon (<link rel="icon">)');
  // A link preview fetches og:image by absolute URL; it must be a file this build emitted.
  const og = html.match(/<meta property="og:image" content="([^"]*)"/);
  if (og && !og[1].startsWith(SITE)) problems.push(`og:image outside ${SITE}: ${og[1]}`);
  else if (og && !exists(og[1].slice(SITE.length))) problems.push(`og:image not emitted: ${og[1]}`);
  const refs = [
    ...[...html.matchAll(/<script\b[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link\b[^>]*\shref="([^"]*)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]),
  ];
  for (const ref of refs) {
    if (!ref.startsWith(BASE)) problems.push(`asset outside ${BASE}: ${ref}`);
    else {
      const rel = ref.slice(BASE.length);
      const addedLater = !kit && KIT.has(rel);
      if (!addedLater && !exists(rel)) problems.push(`asset not emitted: ${ref}`);
    }
  }
  return problems;
}

/** -> problems with a built stylesheet: any url() or @import that leaves the site. */
export function checkBuiltCss(css) {
  const problems = [];
  for (const m of css.matchAll(/url\(\s*["']?([^"')]+)/g)) {
    if (/^(https?:)?\/\//.test(m[1])) problems.push(`external url(): ${m[1]}`);
  }
  if (/@import\s+(url\()?["']?(https?:)?\/\//.test(css)) problems.push('external @import');
  return problems;
}

function main(dist, kit) {
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) throw new Error(`check-dist: ${index} was not built`);
  const problems = checkBuiltHtml(fs.readFileSync(index, 'utf8'), (rel) => fs.existsSync(path.join(dist, rel)), { kit });
  const assets = path.join(dist, 'assets');
  for (const f of fs.existsSync(assets) ? fs.readdirSync(assets) : []) {
    if (f.endsWith('.css')) problems.push(...checkBuiltCss(fs.readFileSync(path.join(assets, f), 'utf8')).map((p) => `${f}: ${p}`));
  }
  if (problems.length) throw new Error(`check-dist failed:\n  ${problems.join('\n  ')}`);
  console.log(`check-dist: ${path.relative(process.cwd(), index)} is self-contained`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    main(path.resolve(args.find((a) => a !== '--kit') ?? 'dist'), args.includes('--kit'));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
