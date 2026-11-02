// views.mjs: everything a person reads about the work, rendered from the journal on demand. There are no progress, diary or decision
// files to keep up to date. Journal text came from models and reviewers, so control characters are stripped before it reaches a
// terminal or a PR body.

import { deriveCursor } from './journal.mjs';
import { isBlocking } from './policy.mjs';

const plain = (s) => String(s ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').trim();
const short = (sha) => (sha ? plain(sha).slice(0, 8) : 'no commit');
const place = (f) => (f.line ? `${plain(f.file)}:${f.line}` : plain(f.file));

// Findings from every review pass that did not re-loop, once each, plus anything imported by `somi migrate`.
export function loggedFindings(events) {
  const seen = new Set();
  const logged = events.filter((e) => e.type === 'after-review').flatMap((e) => e.findings).filter((f) => !isBlocking(f)).filter((f) => {
    if (seen.has(f.fingerprint)) return false;
    seen.add(f.fingerprint);
    return true;
  });
  const migrated = events.filter((e) => e.type === 'migrate').flatMap((e) => e.findings ?? []);
  return [...logged, ...migrated];
}

const decisions = (events) => events.filter((e) => e.type === 'decide' || (e.type === 'migrate' && e.decisions)).flatMap((e) => (e.type === 'decide' ? [plain(e.text)] : e.decisions.map(plain)));

export function renderStatus(events) {
  const c = deriveCursor(events);
  const lines = [];
  if (c.milestone === null) lines.push('No milestone open.');
  else {
    lines.push(`Open: ${plain(c.title)}`, `Next: ${c.next}, after ${c.pass} review pass${c.pass === 1 ? '' : 'es'}`);
    if (c.stop) lines.push(`Stopped: ${c.stop}`, `Question: ${plain(c.question)}`);
  }
  const closed = events.filter((e) => e.type === 'close');
  if (closed.length > 0) {
    const titles = new Map(events.filter((e) => e.type === 'open').map((e) => [e.milestone, e.title]));
    lines.push('', 'Closed:', ...closed.map((e) => `- ${plain(titles.get(e.milestone))}: ${e.outcome} at ${short(e.sha)}`));
  }
  const findings = loggedFindings(events);
  if (findings.length > 0) lines.push('', 'Logged findings, not looped:', ...findings.map((f) => `- ${f.severity} ${place(f)}: ${plain(f.claim)}`));
  const said = decisions(events);
  if (said.length > 0) lines.push('', 'Decisions:', ...said.map((t) => `- ${t}`));
  return `${lines.join('\n')}\n`;
}

// Only what a PR reader can use. Local ids stay out: they do not resolve for anyone who clones the repository.
export function renderPr(events) {
  const titles = new Map(events.filter((e) => e.type === 'open').map((e) => [e.milestone, e.title]));
  const closed = events.filter((e) => e.type === 'close');
  const reviews = events.filter((e) => e.type === 'after-review');
  const fullChecks = events.filter((e) => e.type === 'check' && e.full);
  const lines = ['## Summary', ''];
  if (closed.length === 0) lines.push('- No finished work recorded.');
  for (const e of closed) lines.push(`- ${plain(titles.get(e.milestone))} (${e.outcome}, ${short(e.sha)})`);
  lines.push('', '## Review', '');
  if (reviews.length === 0) lines.push('No review was triggered: no signal fired on the diff.');
  for (const e of reviews) {
    const by = e.verdicts.map((v) => `${v.agent}: ${v.verdict}`).join(', ');
    lines.push(`- ${plain(titles.get(e.milestone))}, pass ${e.pass}: ${by}`);
  }
  const findings = loggedFindings(events);
  if (findings.length > 0) lines.push('', '## Open findings', '', ...findings.map((f) => `- ${f.severity} ${place(f)}: ${plain(f.claim)}`));
  const said = decisions(events);
  if (said.length > 0) lines.push('', '## Decisions', '', ...said.map((t) => `- ${t}`));
  lines.push('', '## Checks', '', fullChecks.length > 0 ? `Full suite: ${fullChecks.at(-1).ok ? 'passed' : 'failed'}.` : 'Full suite: not recorded.');
  return `${lines.join('\n')}\n`;
}
