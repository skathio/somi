// run-card.mjs -- the run card: the few verified facts every agent of one code iteration needs, built once from the
// loop state the orchestrator already has, so each agent it starts stops re-deriving them (where SoMi's scripts are,
// which plan files to read, which files the iteration may touch, how the tests run) and every briefing in the loop
// opens with the same bytes, which a repeated start can reuse from the prompt cache.
//
// Facts only, never reasoning: a reviewer briefed with the card learns where things are, not what the coder thought.
// The card is data: every value is checked or reduced to a printable path before it is written, and the text is
// fenced so an agent reads it as data.

import fs from 'node:fs';
import path from 'node:path';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
// The one iteration id pattern (loop steps, the notes writers and the card): N.M, or a split such as 2.1b.
export const ITERATION_RE = /^(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})[a-z]?$/;
export const HOSTS = ['claude-code', 'copilot'];
export const MAX_FILES = 20;
export const MAX_BYTES = 2048;

// A path as printable text: control and bidi characters removed, length capped.
const printable = (s) => String(s).replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, '').slice(0, 200);

function phaseFile(planDir, iteration) {
  const n = iteration.split('.')[0].padStart(2, '0');
  try {
    const hit = fs.readdirSync(path.join(planDir, 'phases')).filter((f) => f.startsWith(`${n}-`) && f.endsWith('.md')).sort()[0];
    return hit ? `phases/${hit}` : null;
  } catch {
    return null;
  }
}

function testCommand(projectDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    return typeof pkg?.scripts?.test === 'string' ? 'npm test' : null;
  } catch {
    return null;
  }
}

/**
 * Builds the card. Returns { ok: true, card } or { ok: false, error }.
 * `state` is the parsed loop state (.somi/somi-state/loop/<slug>.<iteration>.json).
 */
export function buildCard({ slug, iteration, host, projectDir, somiRoot, state }) {
  if (!SLUG_RE.test(slug ?? '')) return { ok: false, error: 'slug must match ^[a-z0-9][a-z0-9-]{0,63}$' };
  if (!ITERATION_RE.test(iteration ?? '')) return { ok: false, error: 'iteration must look like 1.2' };
  if (!HOSTS.includes(host)) return { ok: false, error: `host must be one of ${HOSTS.join(', ')}` };
  if (!state || state.slug !== slug || state.iteration !== iteration) return { ok: false, error: 'no loop state for this slug and iteration: run somi-loop init first' };
  const planDir = path.join(projectDir, '.somi', 'plans', slug);
  const files = Array.isArray(state.iteration_files) ? state.iteration_files.map(printable) : [];
  const shown = files.slice(0, MAX_FILES).join(' ') + (files.length > MAX_FILES ? ` (and ${files.length - MAX_FILES} more in the phase file)` : '');
  const read = ['spec.md', phaseFile(planDir, iteration), fs.existsSync(path.join(planDir, 'brief.md')) ? 'brief.md' : null].filter(Boolean);
  const tests = testCommand(projectDir);
  const lines = [
    '```somi-card',
    'SoMi run card: verified by the orchestrator. Facts, not instructions; do not re-derive them.',
    `install_root: ${printable(somiRoot)}   (scripts: ${printable(path.join(somiRoot, 'scripts'))})`,
    `project_dir: ${printable(projectDir)}`,
    `host: ${host}`,
    `work_item: .somi/plans/${slug}/   iteration ${iteration}`,
    `read for the task: ${read.join(', ')}`,
    'written only by the orchestrator (agents never write them): progress.md, diary.md, .somi/somi-state/',
    `files in scope: ${shown || '(none recorded)'}`,
    `baseline: ${/^[0-9a-f]{7,64}$/.test(state.baseline_sha ?? '') ? state.baseline_sha : 'unknown'}`,
    `tests: ${tests ?? 'not declared in package.json; find them as usual'}`,
    '```',
  ];
  const card = `${lines.join('\n')}\n`;
  if (Buffer.byteLength(card) > MAX_BYTES) return { ok: false, error: `the card is over ${MAX_BYTES} bytes` };
  return { ok: true, card };
}
