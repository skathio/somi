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
//   3. it still names the cold-start (after /plan-loop) anchor;
//   4. the Stage -1 gate sentences (every tier has one gate, no code before it, a reply is required,
//      no auto-approve, no retry below the floor, trivial is no target, both tiers stop there), each
//      anchored through its terminal period.
//
// Usage: node checkpoint-gate.mjs <path-to-ship-loop.md>
// Exit 0 with "ok" on stdout when all of them hold; exit 1 with one named reason per miss otherwise.

import { readFileSync } from 'node:fs';

// Each anchor is a whole sentence through its terminal period, so an appended exception ("..., unless
// ...") no longer matches. Whitespace is free (and a quote marker), because the prose is hard-wrapped.
export const SENTENCE_ANCHORS = [
  [/Every[\s>]+tier[\s>]+has[\s>]+exactly[\s>]+one[\s>]+gate:[\s>]+`trivial`[\s>]+and[\s>]+`small`[\s>]+gate[\s>]+at[\s>]+Stage[\s>]+-1,[\s>]+before[\s>]+any[\s>]+code;[\s>]+`full`[\s>]+gates[\s>]+as[\s>]+above\./,
    'no "every tier has exactly one gate" sentence -- no tier may run without its one human gate'],
  [/No\s+code\s+runs\s+before\s+the\s+Stage\s+-1\s+gate\./,
    'no "no code runs before the Stage -1 gate" sentence -- trivial and small must gate before any code'],
  [/Do\s+not\s+proceed\s+without\s+one\s+of\s+these\s+replies\./,
    'no "do not proceed without one of these replies" sentence -- the Stage -1 gate needs a reply'],
  [/There\s+is\s+no\s+auto-approve;\s+the\s+A\/B\s+harness\s+answers\s+`Approved\.`\s+as\s+operator\./,
    'no "there is no auto-approve" sentence -- a non-interactive run stops at the gate'],
  [/Do\s+not\s+retry\s+lower\./,
    'no "do not retry lower" sentence -- a refused override must not be retried below the floor'],
  [/Anything\s+else\s+re-asks,\s+and\s+`trivial`\s+is\s+never\s+a\s+target\./,
    'no "trivial is never a target" sentence -- trivial is not an override target'],
  [/`trivial`\s+and\s+`small`\s+stop\s+at\s+the\s+gate\s+below\./,
    'no "trivial and small stop at the gate below" sentence -- both tiers must stop at the Stage -1 gate'],
];

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
  for (const [re, message] of SENTENCE_ANCHORS) {
    if (!re.test(text)) problems.push(message);
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
  console.log('ok (checkpoint still non-overridable; both anchors named; every tier gated)');
}

// Only run as a CLI when invoked directly -- tests/scripts/checkpoint-gate.sh imports
// checkCheckpoint() instead, to exercise it against synthetic fixtures.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
