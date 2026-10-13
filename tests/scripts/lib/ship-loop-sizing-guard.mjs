// ship-loop-sizing-guard.mjs <ship-loop.md> <routing SKILL.md> -- the command may point at the
// routing skill's Size tiers section but must not hold a second copy of the rubric. Prints "ok ..."
// (exit 0) or one problem per line (exit 1):
//   1. exactly one reference to somi-routing/SKILL.md#size-tiers;
//   2. no threshold constant name, no signal id of the rubric, and no threshold number;
//   3. no label and no five consecutive words of the trivial threshold's numbered signals.
import { readFileSync } from 'node:fs';

const [cmdPath, skillPath] = process.argv.slice(2);
const cmd = readFileSync(cmdPath, 'utf8');
const skill = readFileSync(skillPath, 'utf8');
const problems = [];

const refs = cmd.split('somi-routing/SKILL.md#size-tiers').length - 1;
if (refs !== 1) problems.push(`expected exactly one reference to somi-routing/SKILL.md#size-tiers, found ${refs}`);

const copied = [
  [/\b(?:TRIVIAL_)?MAX_[A-Z_]+\b/, 'a threshold constant name'],
  [/\b(?:hard_surface|design_open|open_questions|acceptance_testable|modules_touched|est_files|est_diff_lines)\b/, 'a rubric signal id'],
  [/\b250\b|>\s*2\b|\b6 files\b/, 'a threshold number'],
  [/[<>\u2264\u2265]\s*=?\s*\d/, 'a numeric comparison'],
  [/\b(?:100|50)\b[^.\n]{0,24}\blines?\b|\blines?\b[^.\n]{0,24}\b(?:100|50)\b/i, 'a line-count limit'],
  [/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|fifty|hundred)\s+(?:production\s+)?(?:files?|lines?|modules?)\b/i, 'a spelled-out size limit'],
];
for (const [re, what] of copied) {
  const m = re.exec(cmd);
  if (m) problems.push(`the command repeats ${what}: "${m[0]}"`);
}

const words = (t) => t.toLowerCase().replace(/[`*_]/g, '').split(/[^a-z0-9-]+/).filter(Boolean);
const cmdWords = ` ${words(cmd).join(' ')} `;
const start = skill.indexOf('## The trivial threshold');
const body = skill.slice(start).split(/\n## /)[0];
const items = body.split(/\n(?=\d+\. )/).filter((t) => /^\d+\. \*\*/.test(t)).map((t) => t.split(/\n\n/)[0]);
if (items.length !== 5) problems.push(`the trivial threshold lists ${items.length} numbered signals, expected 5`);
for (const text of items) {
  const label = /\*\*([^*]+)\*\*/.exec(text)[1];
  if (cmdWords.includes(` ${words(label).join(' ')} `)) problems.push(`the command repeats the signal label "${label}"`);
  const w = words(text.replace(/^\d+\. \*\*[^*]+\*\*/, ''));
  for (let i = 0; i + 5 <= w.length; i++) {
    if (cmdWords.includes(` ${w.slice(i, i + 5).join(' ')} `)) {
      problems.push(`the command copies trivial-threshold text: "${w.slice(i, i + 5).join(' ')}"`);
      break;
    }
  }
}

if (problems.length) {
  console.log(problems.join('\n'));
  process.exit(1);
}
console.log('ok one skill reference, no copied rubric text');
