// workflows.mjs: what each route is, at which tier, and the role text it gets. The library behind it can grow without adding anything to
// what a host lists.
//   kind code      work that changes code, which ends in a look at the diff to see whether a review is due.
//   kind plan      a plan the user approves, then milestones with fresh context.
//   kind report    a worker or reviewer produces an answer, and no code changes.
//   kind command   one SoMi command, and its output relayed.
//   kind direct    answered from what is on disk, with no agent.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Writing code is medium work at the least. On the low tier, builds broke rules they were given, wrote tests that passed only their own
// code, and shipped functions far over the quality limits, and the fixes cost more than the low tier saved. The low tier is kept for
// gathering information and running commands.
export const WORKFLOWS = Object.freeze({
  build: { kind: 'code', role: 'build', tier: 'medium', skills: ['testing-checklist'] },
  debug: { kind: 'code', role: 'debug', tier: 'medium', skills: ['testing-checklist'] },
  refactor: { kind: 'code', role: 'refactor', tier: 'medium', skills: ['testing-checklist'] },
  upgrade: { kind: 'code', role: 'upgrade', tier: 'medium', skills: ['ci-infra-gotchas'] },
  migrate: { kind: 'code', role: 'migrate', tier: 'medium', skills: ['ci-infra-gotchas'], alwaysReview: true },
  perf: { kind: 'code', role: 'perf', tier: 'medium', skills: ['perf-method'] },
  incident: { kind: 'code', role: 'incident', tier: 'medium', skills: [] },
  accessibility: { kind: 'code', role: 'accessibility', tier: 'medium', skills: ['accessibility'] },
  plan: { kind: 'plan', role: 'plan', tier: 'medium', skills: [] },
  design: { kind: 'report', role: 'design', tier: 'high', skills: ['threat-modeling'] },
  discover: { kind: 'report', role: 'discover', tier: 'medium', skills: [] },
  atlas: { kind: 'report', role: 'atlas', tier: 'medium', skills: [] },
  answer: { kind: 'report', role: 'answer', tier: 'low', skills: [] },
  review: { kind: 'report', role: 'review', agent: 'somi:somi-reviewer', tier: 'medium', skills: ['testing-checklist'] },
  'security-review': { kind: 'report', role: 'security-review', agent: 'somi:somi-security-reviewer', tier: 'high', skills: ['secure-coding', 'threat-modeling'] },
  ship: { kind: 'command', tier: 'low' },
  status: { kind: 'direct' },
  config: { kind: 'direct' },
  resume: { kind: 'direct' },
});

export const workerAgent = (tier) => `somi:somi-worker-${tier}`;
const WORKERS = Object.freeze({ 'somi-worker-low': 'low', 'somi-worker-medium': 'medium', 'somi-worker-high': 'high' });
// Judging a diff is judgement work, so the code reviewer is never on the low tier.
const REVIEWERS = Object.freeze({ 'somi-reviewer': 'medium', 'somi-security-reviewer': 'high' });
const plainName = (name) => String(name ?? '').split(':').pop();
export const tierForWorker = (name) => (Object.hasOwn(WORKERS, plainName(name)) ? WORKERS[plainName(name)] : null);
export const tierForReviewer = (name) => (Object.hasOwn(REVIEWERS, plainName(name)) ? REVIEWERS[plainName(name)] : null);

const LIBRARY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'library');
export const libraryPath = (kind, name) => path.join(LIBRARY, kind, `${name}.md`);
export const roleBrief = (role) => fs.readFileSync(libraryPath('roles', role), 'utf8').trim();

export function expertiseIndex() {
  const dir = path.join(LIBRARY, 'skills');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const first = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').find((l) => l.startsWith('Use when')) ?? '';
    return { name: f.replace(/\.md$/, ''), when: first, path: path.join(dir, f) };
  });
}
