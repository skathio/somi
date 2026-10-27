#!/usr/bin/env node
// The overview page's roadmap (site/src/content/roadmap.json) must account for every release in
// CHANGELOG.md, so a release cannot be cut with the published page still describing the one before.
// scripts/validate.sh runs this, and publish.yml's `version` job runs validate.sh against the
// dispatched ref, so the check holds at release time, not only on PRs.
//
// Each roadmap entry lists the releases it `covers`. Together the entries must cover every
// `## [X.Y.Z] — YYYY-MM-DD — …` heading exactly once, name no release the CHANGELOG lacks, include
// their own `version` in `covers`, and end (last era, last entry) with the latest release.
//
// Usage: node tests/scripts/lib/site-roadmap-gate.mjs [repoRoot]
// Exit: 0 consistent; 1 a mismatch (each one listed); 2 a file missing or unreadable.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const CHANGELOG = 'CHANGELOG.md';
const ROADMAP = 'site/src/content/roadmap.json';

function read(rel, parse) {
  try {
    return parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch (err) {
    console.error(`site-roadmap-gate: cannot read ${rel}: ${err.message}`);
    process.exit(2);
  }
}

const releases = read(CHANGELOG, (t) => [...t.matchAll(/^## \[(\d+\.\d+\.\d+)\] — \d{4}-\d{2}-\d{2} — /gm)].map((m) => m[1]));
const roadmap = read(ROADMAP, JSON.parse);
if (!releases.length) {
  console.error(`site-roadmap-gate: no release headings in ${CHANGELOG}`);
  process.exit(2);
}
if (!Array.isArray(roadmap.eras)) {
  console.error(`site-roadmap-gate: ${ROADMAP} has no "eras" list`);
  process.exit(2);
}

const entries = roadmap.eras.flatMap((era) => (Array.isArray(era.entries) ? era.entries : []));
const problems = [];
const seen = new Map();
for (const e of entries) {
  const covers = Array.isArray(e.covers) ? e.covers : [];
  if (!covers.includes(e.version)) problems.push(`entry ${e.version} does not list its own version in "covers"`);
  for (const v of covers) {
    if (seen.has(v)) problems.push(`${v} is covered twice (entries ${seen.get(v)} and ${e.version})`);
    seen.set(v, e.version);
    if (!releases.includes(v)) problems.push(`${v} is on the roadmap but not a release in ${CHANGELOG}`);
  }
}
for (const v of releases) {
  if (!seen.has(v)) problems.push(`release ${v} is missing from the roadmap: add it to an entry's "covers" in ${ROADMAP}`);
}
const last = entries.at(-1)?.version;
if (last !== releases[0]) problems.push(`the roadmap ends at ${last}, not the latest release ${releases[0]}`);

if (problems.length) {
  console.error(`SITE ROADMAP OUT OF DATE (${ROADMAP} against ${CHANGELOG}):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`  site roadmap covers all ${releases.length} releases, latest ${releases[0]}`);
