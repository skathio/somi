// site/README.md tells a contributor which site-check.yml job checks the page and the docs on a pull request. A job it
// names must exist, or the reader looks for a check that never runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

// The job keys of a workflow: two-space-indented keys under `jobs:`.
function jobNames(rel) {
  const text = read(rel);
  return [...text.slice(text.search(/^jobs:\s*$/m)).matchAll(/^ {2}([A-Za-z0-9_-]+):[ \t]*$/gm)].map((m) => m[1]);
}

// The paragraph of the README that describes what pull requests run.
function pullRequestParagraph() {
  const para = read('site/README.md').split(/\n\s*\n/).find((p) => /Pull requests run/.test(p));
  assert.ok(para, 'site/README.md says what pull requests run');
  return para.replace(/\s+/g, ' ');
}

test('every site-check.yml job the site README names for pull requests exists', () => {
  const named = [...pullRequestParagraph().matchAll(/`([a-z0-9-]+)` job/g)].map((m) => m[1]);
  assert.ok(named.length >= 1, 'the README names the job');
  const jobs = jobNames('.github/workflows/site-check.yml');
  for (const name of named) assert.ok(jobs.includes(name), `site-check.yml has no \`${name}\` job; it has ${jobs.join(', ')}`);
});

test('the site README says the pull request build covers the docs and deploys nothing', () => {
  const para = pullRequestParagraph();
  assert.match(para, /docs/);
  assert.match(para, /without deploying/);
});
