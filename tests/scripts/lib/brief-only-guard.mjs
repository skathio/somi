// brief-only-guard.mjs <code.md> <code-loop.md> -- both commands must accept a one-iteration work item
// made of a brief and no phase files, and refuse it without the sizing CLI's tier record. Prints
// "ok ..." (exit 0) or one problem per line (exit 1).
import { readFileSync } from 'node:fs';

const flat = (p) => readFileSync(p, 'utf8').replace(/\s+/g, ' ');
const [code, loop] = process.argv.slice(2).map(flat);
const problems = [];

const anchors = [
  ['names the brief-only item', /brief-only work item/i],
  ['names its shape: brief.md and progress.md, no phases/', /`brief\.md` and `progress\.md`[^.]*no `phases\/`/],
  ['fixes the iteration as 1.1', /iteration `?1\.1`?/],
  ['requires the CLI tier record for the slug', /tier record|somi-state\/tier\/<slug>\.json/],
  ['requires a non-null signals_sha256', /non-null `signals_sha256`/],
  ['requires the small tier', /`tier` (?:equal to |)`small`/],
  ['refuses and recommends /plan', /(?:stop|refuse)[^.]*`\/plan <problem>`/],
];
for (const [name, text] of [['code.md', code], ['code-loop.md', loop]]) {
  for (const [what, re] of anchors) if (!re.test(text)) problems.push(`${name} does not state: ${what}`);
}
if (!/(?:Never create the record or edit it by hand)/.test(code) || !/never create or edit that record by hand/.test(loop)) problems.push('code.md does not forbid creating or editing the record');
for (const [n, t] of [['code.md', code], ['code-loop.md', loop]]) if (/\b(?:skip this|any tier|or create|write (?:one|it) by hand|without a record)\b/i.test(t)) problems.push(`${n} permits bypassing the tier record`);
if (/TRIVIAL_MAX_|MAX_FILES|MAX_MODULES|MAX_DIFF_LINES|hard_surface|est_files/.test(code + loop)) problems.push('the commands repeat a rubric constant or signal id');

if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log('both commands accept the brief-only item only with a small-tier record');
