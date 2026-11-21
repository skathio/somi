// brief-parse.mjs: what a brief must say before it is ready to hand off. Its numbered requirements become the staged workflow's request
// lines, so every stage that checks the code against the request checks it against these same numbers. A brief that leaves a choice open
// is not ready, so one with no requirement, no handoff, or open questions still listed is refused. Pure.

import { StateError } from './state.mjs';

const MAX_BRIEF_LINES = 200;
export const MAX_BRIEF_BYTES = 16384;
export const MAX_REQUIREMENTS = 40;
const MAX_REQUIREMENT_CHARS = 600;
const HANDOFFS = Object.freeze(['deliver', 'somi']);
// Each heading the brief may have, and the field it fills. A heading outside this list is refused, so a section cannot go unread.
const SECTIONS = Object.freeze({
  goal: 'goal',
  requirements: 'requirements',
  decisions: 'decisions',
  'out of scope': 'out_of_scope',
  conventions: 'conventions',
  acceptance: 'acceptance',
  boundaries: 'boundaries',
  context: 'context',
  handoff: 'handoff',
  'open questions': 'open_questions',
});
const oneLine = (s) => String(s ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').trim();
const ITEM = /^\s*(?:[-*]|\d+[.)])\s+(.+)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.+)$/;

// A refusal says what to change, so the agent can fix the brief and save it again.
const need = (holds, message) => { if (!holds) throw new StateError(message); };

// The text before the first ## heading holds the title; each ## heading opens a section, and its non-empty lines are its body.
function sectionsOf(text) {
  const [head, ...parts] = String(text).split(/^##[ \t]+/m);
  const title = oneLine(/^#\s+(?:brief:\s*)?(.+)$/im.exec(head)?.[1]);
  const found = {};
  for (const part of parts) {
    const [heading, ...body] = part.split('\n');
    const name = heading.trim().toLowerCase();
    need(Object.hasOwn(SECTIONS, name), `a brief has no section "${oneLine(heading).slice(0, 80)}"; its sections are ${Object.keys(SECTIONS).join(', ')}`);
    need(!Object.hasOwn(found, SECTIONS[name]), `a brief has one ## ${name} section; merge the two`);
    found[SECTIONS[name]] = body.filter((l) => l.trim() !== '');
  }
  return { title, found };
}

const items = (lines = []) => lines.map((l) => ITEM.exec(l)?.[1] ?? l).map(oneLine).filter(Boolean);

// Requirements are numbered 1, 2, 3 with no gap, because the stages after cite them by number.
function requirementsOf(lines = []) {
  const numbered = lines.map((l) => NUMBERED.exec(l)).filter(Boolean);
  need(numbered.length > 0, 'a brief needs at least one requirement, numbered "1. ..." under ## Requirements');
  need(numbered.length === lines.length, 'every line under ## Requirements is one numbered requirement; put detail in the requirement itself');
  need(numbered.length <= MAX_REQUIREMENTS, `a brief holds at most ${MAX_REQUIREMENTS} requirements; split the work into two briefs`);
  return numbered.map((m, i) => {
    need(Number(m[1]) === i + 1, `requirements are numbered 1, 2, 3 in order; number ${i + 1} reads ${m[1]}`);
    const text = oneLine(m[2]);
    need(text.length <= MAX_REQUIREMENT_CHARS, `requirement ${i + 1} is over ${MAX_REQUIREMENT_CHARS} characters; split it`);
    return text;
  });
}

// The context section holds facts a builder would otherwise scout for: "Files:", "Tests:" and "Size:" lines.
function contextOf(lines = []) {
  const field = (name) => items(lines).find((l) => l.toLowerCase().startsWith(`${name}:`))?.slice(name.length + 1).trim() ?? '';
  const files = field('files').split(',').map((f) => f.trim().replace(/^`|`$/g, '')).filter(Boolean);
  const tests = field('tests').replace(/^`|`$/g, '');
  return { files, test_command: tests, size: field('size') };
}

export function parseBrief(text) {
  need(String(text).split('\n').length <= MAX_BRIEF_LINES && Buffer.byteLength(String(text)) <= MAX_BRIEF_BYTES, `a brief is limited to ${MAX_BRIEF_LINES} lines and ${MAX_BRIEF_BYTES} bytes; state requirements, not the detail of how to build them`);
  const { title, found } = sectionsOf(text);
  need(title, 'a brief starts with a "# Brief: <title>" line');
  const goal = items(found.goal).join(' ');
  need(goal, 'a brief needs a ## Goal saying what the work is for, in the user\'s words');
  const open = items(found.open_questions).filter((q) => !/^(none|n\/a)\.?$/i.test(q));
  need(open.length === 0, `a brief with ${open.length} open question(s) is not ready to hand off; settle them with the user first`);
  const handoff = items(found.handoff)[0]?.split(/[\s:,.(]/)[0].toLowerCase() ?? '';
  need(HANDOFFS.includes(handoff), `## Handoff starts with ${HANDOFFS.join(' or ')}`);
  return {
    title,
    goal,
    requirements: requirementsOf(found.requirements),
    decisions: items(found.decisions),
    out_of_scope: items(found.out_of_scope),
    conventions: items(found.conventions),
    acceptance: items(found.acceptance),
    boundaries: items(found.boundaries),
    ...contextOf(found.context),
    handoff,
    handoff_why: oneLine(items(found.handoff)[0]?.slice(handoff.length).replace(/^[\s:,.(-]+/, '').replace(/\)$/, '')),
  };
}
