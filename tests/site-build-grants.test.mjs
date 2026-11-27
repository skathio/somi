// pages-site with `deploy: false` makes its caller grant pages: write and id-token: write for a deploy job that
// never runs. pages: write stays on the jobs that call the Pages workflows, never on a job that runs steps, and
// on pull requests so does id-token: write (the release's `publish` job holds its own, for npm). The pull
// request build lives in site-check.yml, not ci.yml, so a read-only token (Dependabot, a fork) that stops it at
// start cannot fail ci.yml's required `ci / passed`; site-check.yml says so where a maintainer will look.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const CI = '.github/workflows/ci.yml';
const CHECK = '.github/workflows/site-check.yml';
const PAGES_CALL = /^ {4}uses:\s*(skathio\/hashira\/\.github\/workflows\/pages-site\.yml@v3|\.\/\.github\/workflows\/site\.yml)\b/m;
const PAGES_WRITE = /^\s*pages:\s*write\b/m;
const OIDC = /^\s*id-token:\s*write\b/m;

// Each job of a workflow: its body, and the comment lines directly above its key.
function jobs(rel) {
  const lines = read(rel).split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const keys = lines.flatMap((l, i) => (i > start && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(l) ? [i] : []));
  return keys.map((at, n) => {
    let top = at;
    while (/^\s*#/.test(lines[top - 1])) top -= 1;
    return { name: lines[at].trim().slice(0, -1), comment: lines.slice(top, at).join('\n'), body: lines.slice(at + 1, keys[n + 1] ?? lines.length).join('\n') };
  });
}

for (const rel of [CHECK, '.github/workflows/publish.yml', '.github/workflows/site.yml']) {
  test(`${rel}: only a job that calls the Pages workflow holds pages: write`, () => {
    const all = jobs(rel);
    assert.ok(all.some((j) => PAGES_CALL.test(j.body)), 'a job calls the Pages workflow');
    for (const job of all) {
      if (PAGES_CALL.test(job.body)) continue;
      assert.doesNotMatch(job.body, PAGES_WRITE, `${rel} ${job.name} runs steps with pages: write`);
    }
  });
}

test('site-check.yml: no job that runs steps on a pull request holds id-token: write', () => {
  for (const job of jobs(CHECK)) {
    if (!PAGES_CALL.test(job.body)) assert.doesNotMatch(job.body, OIDC, `site-check.yml ${job.name}`);
  }
});

// A pages-site call refused at start fails its whole workflow: in ci.yml that would be the required `ci / passed`.
test('ci.yml calls no Pages workflow and grants neither pages: write nor id-token: write', () => {
  for (const job of jobs(CI)) {
    assert.doesNotMatch(job.body, PAGES_CALL, `ci.yml ${job.name}`);
    assert.doesNotMatch(job.body, PAGES_WRITE, `ci.yml ${job.name}`);
    assert.doesNotMatch(job.body, OIDC, `ci.yml ${job.name}`);
  }
});

test("site-check.yml's site job says what a Dependabot or fork pull request, whose token is read-only, gets", () => {
  const site = jobs(CHECK).find((j) => PAGES_CALL.test(j.body));
  assert.ok(site, 'the pages-site job');
  const said = `${site.comment}\n${site.body}`.split('\n').filter((l) => /^\s*#/.test(l)).join(' ').replace(/\s*#\s*/g, ' ');
  assert.match(said, /Dependabot/);
  assert.match(said, /fork/i);
  assert.match(said, /read-only/);
});
