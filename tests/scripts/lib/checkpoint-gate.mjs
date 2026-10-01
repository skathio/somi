#!/usr/bin/env node
// checkpoint-gate.mjs — guards commands/ship-loop.md's single non-overridable human checkpoint.
//
// The checkpoint was re-anchored from a cost-tier boundary (one that stopped
// existing once commands declared no tier and execution itself could mix tiers) to the brief
// handoff: it fires once a design action has produced a brief.md, before planning consumes it, or
// -- on a cold start with no design action -- after /plan-loop, before any code. Nothing else in
// this repo tests that a later edit to ship-loop.md keeps that definition intact. This gate is
// deliberately narrow: it does not re-derive the whole retirement sweep (retirement-gate.mjs and
// the DoD's own repo-wide grep already own the old vocabulary), it only asserts the file still
// says the three things that make the checkpoint what it is:
//   1. it is still declared non-overridable;
//   2. it still names the brief-handoff anchor;
//   3. it still names the cold-start (after /plan-loop) anchor.
//
// Usage: node checkpoint-gate.mjs <path-to-ship-loop.md>
// Exit 0 with "ok" on stdout when all three hold; exit 1 with one named reason per miss otherwise.

import { readFileSync } from 'node:fs';

export function checkCheckpoint(text) {
  const problems = [];
  if (!/non-overridable/i.test(text)) {
    problems.push('no "non-overridable" language found -- the checkpoint must stay non-overridable');
  }
  if (!/brief[\s-]?hand[\s-]?off/i.test(text)) {
    problems.push('no mention of the brief-handoff anchor (a design action producing brief.md, before planning consumes it)');
  }
  if (!/after\s+`?\/plan-loop`?/i.test(text)) {
    problems.push('no mention of the cold-start anchor (falls to after /plan-loop when no design action ran)');
  }
  return problems;
}

function main() {
  const [, , file] = process.argv;
  if (!file) {
    console.error('usage: checkpoint-gate.mjs <path-to-ship-loop.md>');
    process.exit(2);
  }
  const text = readFileSync(file, 'utf8');
  const problems = checkCheckpoint(text);
  if (problems.length) {
    for (const p of problems) console.log(`CHECKPOINT GATE: ${p}`);
    process.exit(1);
  }
  console.log('ok (checkpoint still non-overridable; both anchors named)');
}

// Only run as a CLI when invoked directly -- tests/scripts/checkpoint-gate.sh imports
// checkCheckpoint() instead, to exercise it against synthetic fixtures.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
