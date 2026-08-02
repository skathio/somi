#!/usr/bin/env node
// Phase 4 exit criterion: a `rules/` trim that removes or reworsds a digest bullet must update
// tests/hooks/cases/inject-workflow-context.json's marker in the SAME attempt.
//
// Why this needs a guard rather than a note. Phase 1 added a fixture PAIR on that bullet — a
// positive assertion (the digest contains it) and a negative one (Tier 2 is omitted when the
// markers are malformed). Trim the bullet away and the positive assertion pins a substring that
// no longer exists anywhere, so it fails loudly... but only if some case still expects it to be
// PRESENT. The cases that merely carry it as incidental context go quietly vacuous, and the pair
// stops testing the thing it was built for while the suite stays green.
//
// Phase 4's own scope note calls this out: the trim candidates include `rules/`, which is where
// the digest comes from. The guard exists so the coupling is mechanical rather than remembered.

import { readFileSync } from 'node:fs';

const [fixtureFile, hookFile, ...digestFiles] = process.argv.slice(2);
const raw = readFileSync(fixtureFile, 'utf8');
// Backslashes stripped before comparing. The hook builds Tier-1 lines inside template literals,
// so a backtick in the output is written `\\``  in the source -- a literal includes() then misses
// it and reports frame text as a missing digest bullet. Cost me one false positive on
// "Multiple in-progress work items in `.somi/plans/`:", which is at line 445 of the hook.
const unescape = (t) => t.replace(/\\/g, '');
const hook = unescape(readFileSync(hookFile, 'utf8'));
const digests = digestFiles.map((f) => ({ f, text: readFileSync(f, 'utf8') }));

// Which asserted substrings are DIGEST markers rather than Tier-1 frame text?
//
// The discriminator is the hook's own source. Tier 1 is a fixed template the hook emits
// unconditionally, so every string in it is frame ("Status:", "Active work item:"). Tier 2 is
// spliced in from the digest. An asserted substring that does NOT appear in the hook source must
// therefore have come from the digest -- and if it is in neither, a trim removed it and left the
// assertion pinning a string that exists nowhere.
const asserted = [...new Set(
  [...raw.matchAll(/"((?:[^"\\]|\\.){6,70}?:)\\?"/g)]
    .map((m) => m[1].replace(/\\"/g, '"'))
    .filter((t) => /^[A-Z]/.test(t) && !/^(name|id|expect|input|env|cwd|note)/i.test(t)),
)];
const markers = asserted.filter((t) => !hook.includes(unescape(t)));

const problems = [];
for (const marker of markers) {
  const missing = digests.filter((d) => !unescape(d.text).includes(unescape(marker)));
  if (missing.length === digests.length) {
    problems.push(`the fixture asserts "${marker}", which is in neither the hook nor any digest copy — a trim removed the bullet and the fixture was not updated in the same attempt`);
  } else if (missing.length) {
    problems.push(`"${marker}" is missing from ${missing.map((d) => d.f).join(', ')} — the digest copies disagree`);
  }
}
if (asserted.length === 0) problems.push('no asserted substrings found — the extractor is matching nothing, which is not the same as nothing being wrong');

process.stdout.write(problems.length ? problems.join('\n') : `ok (${markers.length} digest marker(s) of ${asserted.length} asserted string(s))`);
