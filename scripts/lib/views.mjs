// views.mjs: what a person reads about the work, rendered from the plan, ledger and review record on demand. Recorded text came from
// models and reviewers, so control characters are stripped before it reaches a terminal or a PR body. Pure, so its output can be pinned.

import { isBlocking } from './policy.mjs';

const plain = (s) => String(s ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').trim();
const place = (f) => (f.line ? `${plain(f.file)}:${f.line}` : plain(f.file));
const finding = (f) => `- ${plain(f.severity)} ${place(f)}: ${plain(f.claim)}`;

function loggedFindings(reviews, migrated = []) {
  const seen = new Set();
  const logged = reviews.flatMap((r) => r.findings ?? []).filter((f) => !isBlocking(f)).filter((f) => {
    if (seen.has(f.fingerprint)) return false;
    seen.add(f.fingerprint);
    return true;
  });
  return [...logged, ...migrated];
}

export function renderStatus({ plan, ledger, reviews = [], check, migrated }) {
  const lines = [];
  if (plan) {
    lines.push(`Plan: ${plan.done} of ${plan.total} milestones done`);
    if (plan.next) lines.push(`Next: ${plain(plan.next)}`);
  } else lines.push('No plan open.');
  const last = reviews.at(-1);
  if (last) lines.push('', `Last review: ${(last.verdicts ?? []).map((v) => `${plain(v.agent)}: ${plain(v.verdict)}`).join(', ')}`);
  const blocking = (last?.findings ?? []).filter(isBlocking);
  if (blocking.length > 0) lines.push('', 'Blocking findings:', ...blocking.map(finding));
  const logged = loggedFindings(reviews, migrated);
  if (logged.length > 0) lines.push('', 'Logged findings:', ...logged.map(finding));
  if (ledger) lines.push('', 'Decisions and limits:', ...ledger.split('\n').map(plain).filter(Boolean));
  if (check) lines.push('', `Last check: ${check.ok ? 'passed' : 'failed'}${check.full ? ' (full suite)' : ''}`);
  return `${lines.join('\n')}\n`;
}

const NOT_REVIEWED = (gate) => (gate.reason === 'open-blocking'
  ? '> **Not cleared by review.** Blocking findings are still open on this change. See below.'
  : `> **Not reviewed.** SoMi's signals asked for a review of this change, and none covers it: ${gate.signals?.map(plain).join(', ') || 'see the diff'}.`);

// Only what a PR reader can use. The commits and the review speak for the work, and local ids stay out, because they do not resolve for
// anyone who clones the repository.
export function renderPr({ subjects = [], gate, ledger, reviews = [], check, tree, migrated }) {
  const lines = [];
  if (!gate.ok) lines.push(NOT_REVIEWED(gate), '');
  lines.push('## Summary', '');
  if (subjects.length === 0) lines.push('- No commits yet.');
  for (const s of subjects) lines.push(`- ${plain(s)}`);
  lines.push('', '## Review', '');
  if (gate.review) lines.push((gate.review.verdicts ?? []).map((v) => `- ${plain(v.agent)}: ${plain(v.verdict)}`).join('\n'));
  else if (gate.ok) lines.push('No review was needed: no signal fired on the diff.');
  else lines.push('None.');
  const blocking = gate.blocking ?? [];
  if (blocking.length > 0) lines.push('', '## Blocking findings', '', ...blocking.map(finding));
  const logged = loggedFindings(reviews, migrated);
  if (logged.length > 0) lines.push('', '## Open findings', '', ...logged.map(finding));
  const said = (ledger ?? '').split('\n').map(plain).filter((l) => l.startsWith('- decision:')).map((l) => `- ${l.slice('- decision:'.length).trim()}`);
  if (said.length > 0) lines.push('', '## Decisions', '', ...said);
  const full = check?.full && check.tree === tree;
  lines.push('', '## Checks', '', full ? `Full suite: ${check.ok ? 'passed' : 'failed'}.` : 'Full suite: not recorded for this code.');
  return `${lines.join('\n')}\n`;
}
