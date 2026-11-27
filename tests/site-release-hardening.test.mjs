// Two failure paths of the page's build that only show up after merge. The release builds the `site` artifact
// before production's approval and deploys it after `publish`, but pages-upload keeps that artifact one day: an
// approval given later would publish to npm and then fail to deploy. And a Dependabot or fork pull request may be
// refused at start by the pages-site call in site-check.yml; its header says why it is not in ci.yml and the way out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

// The lines of one job, from its two-space key to the next one.
function jobLines(rel, name) {
  const lines = read(rel).split('\n');
  const at = lines.findIndex((l) => l === `  ${name}:`);
  assert.ok(at > 0, `${rel} has a ${name} job`);
  const end = lines.findIndex((l, i) => i > at && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(l));
  return { lines: lines.slice(at + 1, end < 0 ? lines.length : end), top: at };
}

// The `uses:` and `with:` lines of each step, in order, without comments.
function steps(body) {
  const out = [];
  for (const line of body) {
    if (/^\s*#/.test(line)) continue;
    if (/^ {6}- /.test(line)) out.push([]);
    if (out.length) out[out.length - 1].push(line);
  }
  return out.map((s) => s.join('\n'));
}

test("publish.yml: the publish job first fetches the `site` artifact, so an expired one fails before npm", () => {
  const { lines } = jobLines('.github/workflows/publish.yml', 'publish');
  const all = steps(lines);
  assert.ok(all.length > 1, 'publish has steps');
  const first = all[0];
  const pinned = /uses:\s*actions\/download-artifact@([0-9a-f]{40})\b/.exec(first);
  assert.ok(pinned, `the first step downloads an artifact by a pinned SHA:\n${first}`);
  // The same pin as the site-kit job's download of the same artifact.
  const kit = steps(jobLines('.github/workflows/publish.yml', 'site-kit').lines).join('\n');
  assert.match(kit, new RegExp(`actions/download-artifact@${pinned[1]}\\b`), 'same SHA as site-kit');
  assert.match(first, /^\s*name:\s*['"]?site['"]?\s*$/m, 'the `site` artifact');
  assert.match(first, /^\s*path:\s*\$\{\{\s*runner\.temp\s*\}\}\//m, 'into runner.temp, outside the checkout');
  const npm = all.findIndex((s) => /npm-release@/.test(s));
  assert.ok(npm > 0, 'npm-release comes after the download');
});

test("site-check.yml says a refused start kept out of ci.yml spares `ci / passed`, and names hashira's 'Your own build' fallback", () => {
  const said = read('.github/workflows/site-check.yml').split('\n').filter((l) => /^\s*#/.test(l)).map((l) => l.replace(/^\s*#\s?/, '')).join(' ');
  assert.match(said, /`ci \/ passed`/);
  assert.match(said, /Your own build/);
});
