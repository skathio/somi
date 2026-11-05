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

function normalizeFinding(raw, agent, i) {
  const where = `${agent} finding ${i + 1}`;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ReviewInputError(`${where} is not an object`);
  if (!SEVERITIES.includes(raw.severity)) throw new ReviewInputError(`${where} has an unknown severity`);
  if (!safeFile(raw.file)) throw new ReviewInputError(`${where} has an unusable file path`);
  // Long text is kept to the limit. Refusing it would throw away the whole report and pay for the review again.
  const claim = typeof raw.claim === 'string' ? raw.claim.slice(0, 400) : raw.claim;
  if (!isText(claim, 400)) throw new ReviewInputError(`${where} needs a claim`);
  const evidence = typeof raw.evidence === 'string' ? raw.evidence.slice(0, 400) : raw.evidence;
  if (evidence !== undefined && evidence !== null && !isText(evidence, 400)) throw new ReviewInputError(`${where} has unusable evidence`);
  if (raw.line !== undefined && raw.line !== null && !(Number.isInteger(raw.line) && raw.line > 0)) throw new ReviewInputError(`${where} has an unusable line`);
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

// `reviews` is what the reviewers returned: untrusted model output. Every dispatched reviewer must be present, because a
// missing security review must not read as a clean one.
export function parseReviews(reviews, dispatched) {
  if (!Array.isArray(reviews)) throw new ReviewInputError('reviews must be an array');
  const seen = new Set();
  const findings = [];
  const verdicts = [];
  for (const review of reviews) {
    if (review === null || typeof review !== 'object') throw new ReviewInputError('a review is not an object');
    if (Buffer.byteLength(JSON.stringify(review)) > MAX_REVIEW_BYTES) throw new ReviewInputError(`a review is over ${MAX_REVIEW_BYTES} bytes; return fewer, shorter findings`);
    const { agent } = review;
    if (!dispatched.some((d) => d.agent === agent)) throw new ReviewInputError('a review names a reviewer that was not dispatched');
    if (seen.has(agent)) throw new ReviewInputError(`${agent} returned twice`);
    seen.add(agent);
    if (!VERDICTS.includes(review.verdict)) throw new ReviewInputError(`${agent} has an unknown verdict`);
    if (!Array.isArray(review.findings)) throw new ReviewInputError(`${agent} has no findings array`);
    verdicts.push({ agent, verdict: review.verdict, model: isText(review.model, 64) && !CONTROL.test(review.model) ? review.model : null });
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
