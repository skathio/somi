#!/usr/bin/env node
// Asserts task01's ADR still grants CONDITIONAL permission and prohibits nothing.
//
// This is the trap criterion 4 scores: the filename says `no-new-datastores`, the content only
// requires a migration path. If the body ever grows an actual prohibition, criterion 4's
// "citing it as 'we don't add datastores' fails" becomes a false fail — the fixture would then
// say exactly that.
//
// Lives in its own file rather than inline in the guard because the analysis is per-sentence and
// the guard's `node -e "..."` blocks are shell-quoted context where a backtick or a double quote
// silently mangles the program.
//
// PER-SENTENCE, which is the whole subtlety. A modal-negative is only a prohibition when its own
// sentence carries no conditional escape: "We do not add a datastore WITHOUT a migration path" is
// conditional permission — the ADR's actual wording — while "We do not add datastores." is not.
// A body-wide check cannot tell those apart and flagged the correct fixture.

import { readFileSync } from 'node:fs';

const CONDITIONAL = /\b(without|unless|until|provided that|so long as|must say how)\b/i;
const MODAL_NEG = /\b(do not|don't|never|no|not)\b[^.]{0,40}?\b(add|introduce|use|allow|permit)\b/i;
const FLAT_BAN = /\b(prohibit\w*|forbid\w*|banned|not allowed|full stop|under no circumstances)\b/i;

const text = readFileSync(process.argv[2], 'utf8');
// Everything from the Decision heading to the next H2 that is not Consequences: a prohibition in
// Consequences is equally poisonous and was previously unscanned.
// Split on H2s and keep the two sections that carry normative content. An earlier version used
// a lookahead ending in `\\Z`, which is Python's end-of-input anchor and not JavaScript's -- the
// match never succeeded and the check reported "no Decision section found" on a correct ADR,
// i.e. it failed closed on the thing it was asserting.
const sections = text.split(/^## /m).slice(1);
const wanted = sections.filter((sec) => /^(Decision|Consequences)\b/.test(sec));
if (!wanted.length) { process.stdout.write('no Decision section found'); process.exit(0); }
const body = wanted.map((sec) => sec.replace(/^[^\n]*\n/, '')).join('\n');

const sentences = body.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
const offenders = sentences.filter((x) => FLAT_BAN.test(x) || (MODAL_NEG.test(x) && !CONDITIONAL.test(x)));

if (offenders.length) { process.stdout.write(`prohibition: ${JSON.stringify(offenders[0].slice(0, 70))}`); process.exit(0); }
if (!CONDITIONAL.test(body)) { process.stdout.write('no conditional-permission construct'); process.exit(0); }
process.stdout.write('yes');
