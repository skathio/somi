// size-tier-drift.mjs <skill.md> <size-tier.mjs> — the routing skill's "Size tiers" section and
// the size-tier module must agree. Prints "ok ..." (exit 0) or one problem per line (exit 1):
//   1. the signal ids in the section's checklist equal SIGNAL_IDS, in order (T1-T5 stands for T1..T5);
//   2. every exported threshold constant appears in the section next to its name with its value;
//   3. the section holds no copy of the trivial threshold's five signal sentences (it points at them).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [skillPath, modPath] = process.argv.slice(2);
const mod = await import(pathToFileURL(modPath).href);
const skill = readFileSync(skillPath, 'utf8');
const problems = [];

const sectionOf = (text, heading) => {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === heading);
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
};

const section = sectionOf(skill, '## Size tiers');
const threshold = sectionOf(skill, '## The trivial threshold');
if (section === null || threshold === null) {
  console.log('the skill needs both a "## Size tiers" and a "## The trivial threshold" section');
  process.exit(1);
}

// 1. ids: first code span of each row of the checklist table (the one whose header cell is "Id").
const checklist = section.split('\n').slice(section.split('\n').findIndex((l) => /^\| Id \|/.test(l)) + 2);
const ids = [];
for (const line of checklist) {
  const m = /^\| `([^`]+)` \|/.exec(line);
  if (!m) break;
  ids.push(...(m[1] === 'T1-T5' ? ['T1', 'T2', 'T3', 'T4', 'T5'] : [m[1]]));
}
if (ids.join() !== mod.SIGNAL_IDS.join()) {
  problems.push(`signal ids differ: skill [${ids.join(', ')}] vs module [${mod.SIGNAL_IDS.join(', ')}]`);
}

// 2. thresholds: the exported numeric constants, each in a table row `NAME` | value |.
const constants = Object.entries(mod).filter(([name, v]) => /^[A-Z_]+$/.test(name) && Number.isInteger(v));
for (const [name, value] of constants) {
  const m = new RegExp(`\\| \`${name}\` \\| (\\d+) \\|`).exec(section);
  if (!m) problems.push(`threshold ${name} is not in the Size tiers table`);
  else if (Number(m[1]) !== value) problems.push(`threshold ${name} is ${m[1]} in the skill but ${value} in the module`);
}

// 3. no copied signal text: neither a signal's label nor any five consecutive words of its sentence.
const words = (t) => t.toLowerCase().replace(/[`*_]/g, '').split(/[^a-z0-9-]+/).filter(Boolean);
const sectionWords = ` ${words(section).join(' ')} `;
const numbered = threshold.split('\n').filter((l) => /^\d+\. \*\*/.test(l));
for (const line of numbered) {
  const label = /\*\*([^*]+)\*\*/.exec(line)[1];
  if (sectionWords.includes(` ${words(label).join(' ')} `)) problems.push(`the section repeats the signal label "${label}"`);
}
// A sentence can wrap onto an indented continuation line, so windows run over the item's own text.
const itemTexts = threshold.split(/\n(?=\d+\. )/).filter((t) => /^\d+\. /.test(t)).map((t) => t.split(/\n\n/)[0]);
for (const text of itemTexts) {
  const w = words(text.replace(/^\d+\. \*\*[^*]+\*\*/, ''));
  for (let i = 0; i + 5 <= w.length; i++) {
    if (sectionWords.includes(` ${w.slice(i, i + 5).join(' ')} `)) {
      problems.push(`the section copies trivial-threshold text: "${w.slice(i, i + 5).join(' ')}"`);
      break;
    }
  }
}
if (numbered.length !== 5) problems.push(`the trivial threshold lists ${numbered.length} numbered signals, expected 5`);

if (problems.length) {
  console.log(problems.join('\n'));
  process.exit(1);
}
console.log(`ok ${ids.length} ids, ${constants.length} thresholds, no copied threshold text`);
