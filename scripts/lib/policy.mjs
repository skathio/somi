// policy.mjs: the review policy as pure functions. These constants are deliberately not configuration: a committed project
// config is untrusted, and nothing in it may lower when a review runs or what re-loops.

import { createHash } from 'node:crypto';

export const SEVERITIES = Object.freeze(['Blocker', 'Major', 'Minor', 'Nit']);
export const VERDICTS = Object.freeze(['approve', 'approve-with-comments', 'request-changes']);
export const MAX_PASSES = 2;
export const MAX_REVIEW_BYTES = 2048;

export class ReviewInputError extends Error {}

const isText = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const safeFile = (f) => isText(f, 240) && !CONTROL.test(f) && !f.startsWith('/') && !/^[a-z]:/i.test(f) && !f.split(/[\\/]/).includes('..');

// Line numbers drift between passes, so identity is the file plus the claim's first words.
function deriveFingerprint(f) {
  const claim = f.claim.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 8).join(' ');
  return createHash('sha256').update(`${f.file}\n${claim}`).digest('hex').slice(0, 16);
}

// A suggestion to remove a safety net is what a confused or injected reviewer produces, so it reaches the coder flagged.
const REMOVES_CHECK = /\b(remove|delete|drop|disable|skip|bypass|relax|weaken|loosen|turn off)\b[^.]{0,60}\b(check|validation|validate|guard|test|assert\w*|flag|sanitiz\w*|escap\w*|auth\w*|limit|gate|hook)\b/i;

// Long text is kept to the limit. Refusing it would throw away the whole report and pay for the review again.
const clip = (v) => (typeof v === 'string' ? v.slice(0, 400) : v);
const present = (v) => v !== undefined && v !== null;

// The checks a finding must pass, in this order: what it is, how bad, where, what it claims, then its optional evidence and line.
function checkFinding(raw, where) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ReviewInputError(`${where} is not an object`);
  if (!SEVERITIES.includes(raw.severity)) throw new ReviewInputError(`${where} has an unknown severity`);
  if (!safeFile(raw.file)) throw new ReviewInputError(`${where} has an unusable file path`);
  const claim = clip(raw.claim);
  if (!isText(claim, 400)) throw new ReviewInputError(`${where} needs a claim`);
  const evidence = clip(raw.evidence);
  if (present(evidence) && !isText(evidence, 400)) throw new ReviewInputError(`${where} has unusable evidence`);
  if (present(raw.line) && !(Number.isInteger(raw.line) && raw.line > 0)) throw new ReviewInputError(`${where} has an unusable line`);
  return { claim, evidence };
}

function normalizeFinding(raw, agent, i) {
  const { claim, evidence } = checkFinding(raw, `${agent} finding ${i + 1}`);
  const finding = {
    id: isText(raw.id, 32) && !CONTROL.test(raw.id) ? raw.id : `${agent}-${i + 1}`,
    agent,
    severity: raw.severity,
    boundary: raw.boundary === true,
    file: raw.file,
    line: raw.line ?? null,
    claim,
    evidence: evidence ?? null,
  };
  finding.fingerprint = isText(raw.fingerprint, 64) && /^[\w.:-]+$/.test(raw.fingerprint) ? raw.fingerprint : deriveFingerprint(finding);
  if (REMOVES_CHECK.test(`${claim} ${evidence ?? ''}`)) finding.needs_verification = true;
  return finding;
}

// A report over the cap loses its least severe findings, last first, until it fits: a session cannot shorten a reviewer's report, and
// refusing it whole led a session to send no report at all. Each finding's size is counted once, so a long list costs no more than a pass.
// A Blocker or Major is never dropped; a report still over the cap without its Minors and Nits is refused, and that reviewer runs again.
const bytes = (v) => Buffer.byteLength(JSON.stringify(v) ?? '');
const TRIM_ORDER = ['Nit', 'Minor'];
function fitReview(review) {
  if (bytes(review) <= MAX_REVIEW_BYTES) return { review, trimmed: 0 };
  const agent = isText(review.agent, 64) && !CONTROL.test(review.agent) ? review.agent : 'a reviewer';
  const over = () => new ReviewInputError(`the report from ${agent} is over ${MAX_REVIEW_BYTES} bytes even without its Minor and Nit findings; re-run that reviewer and ask it for fewer, shorter findings`);
  if (!Array.isArray(review.findings)) throw over();
  const kept = review.findings.map((f) => ({ f, size: bytes(f) + 1 }));
  let total = bytes(review);
  let trimmed = 0;
  for (const severity of TRIM_ORDER) {
    for (let i = kept.length - 1; i >= 0 && total > MAX_REVIEW_BYTES; i -= 1) {
      if (kept[i].f?.severity !== severity) continue;
      total -= kept[i].size;
      kept.splice(i, 1);
      trimmed += 1;
    }
  }
  const fitted = { ...review, findings: kept.map((k) => k.f) };
  if (bytes(fitted) > MAX_REVIEW_BYTES) throw over();
  return { review: fitted, trimmed };
}

// The checks one review must pass, in this order. The reviewer is counted as seen before its verdict is read, so a second report from it
// is refused as a repeat, not read again.
function checkReview(review, dispatched, seen) {
  const { agent } = review;
  if (!dispatched.some((d) => d.agent === agent)) throw new ReviewInputError('a review names a reviewer that was not dispatched');
  if (seen.has(agent)) throw new ReviewInputError(`${agent} returned twice`);
  seen.add(agent);
  if (!VERDICTS.includes(review.verdict)) throw new ReviewInputError(`${agent} has an unknown verdict`);
  if (!Array.isArray(review.findings)) throw new ReviewInputError(`${agent} has no findings array`);
  return agent;
}

// `reviews` is what the reviewers returned: untrusted model output. Every dispatched reviewer must be present, because a
// missing security review must not read as a clean one.
export function parseReviews(reviews, dispatched) {
  if (!Array.isArray(reviews)) throw new ReviewInputError('reviews must be an array');
  const seen = new Set();
  const findings = [];
  const verdicts = [];
  for (const raw of reviews) {
    if (raw === null || typeof raw !== 'object') throw new ReviewInputError('a review is not an object');
    const { review, trimmed } = fitReview(raw);
    const agent = checkReview(review, dispatched, seen);
    verdicts.push({ agent, verdict: review.verdict, model: isText(review.model, 64) && !CONTROL.test(review.model) ? review.model : null, ...(trimmed ? { trimmed } : {}) });
    review.findings.forEach((f, i) => findings.push(normalizeFinding(f, agent, i)));
  }
  const missing = dispatched.filter((d) => !seen.has(d.agent)).map((d) => d.agent);
  if (missing.length > 0) throw new ReviewInputError(`no review from: ${missing.join(', ')}`);
  return { findings, verdicts };
}

// A Major re-loops only when it is confirmed on a real boundary: the reviewer cites file, line and an exploit or failing input.
export const isConfirmedBoundaryMajor = (f) => f.severity === 'Major' && f.boundary && f.line !== null && f.evidence !== null;
export const isBlocking = (f) => f.severity === 'Blocker' || isConfirmedBoundaryMajor(f);

export function decideAfterReview({ findings, pass, extraPasses = 0, previousBlocking = [] }) {
  const blocking = findings.filter(isBlocking);
  const prints = [...new Set(blocking.map((f) => f.fingerprint))].sort();
  if (blocking.length === 0) return { next: 'close', blocking: [] };
  const recurring = prints.filter((p) => previousBlocking.includes(p));
  if (recurring.length > 0) return { next: 'ask', blocking: prints, stop: 'recurring-finding', question: 'The same blocking finding came back after a fix. Keep fixing, or close as it is?' };
  if (pass >= MAX_PASSES + extraPasses) return { next: 'ask', blocking: prints, stop: 'max-passes', question: `${pass} review passes ran and blocking findings remain. Allow one more pass, or close as it is?` };
  return { next: 'fix', blocking: prints };
}
