// reviews.mjs: which review a change needs, what reviewers found, and whether it can leave. A review never blocks the conversation or
// a local commit. The one place it can stop anything is the outward step: SoMi will not write pull request text for a change that needed
// a review and has none, or that has an open blocking finding, unless the text says so at the top. Signals come from the real diff,
// and nothing in a project's config can lower them. The record is a tripwire like the rest of SoMi's hooks, not a security boundary.

import fs from 'node:fs';
import path from 'node:path';
import { readDiff, resolveRef, reviewDiffCommand, snapshotTree, workBase } from './git-tree.mjs';
import { ReviewInputError, decideAfterReview, isBlocking, parseReviews } from './policy.mjs';
import { computeSignals, RECORDED_ONLY, SECURITY_SIGNALS } from './signals.mjs';
import { StateError, appendStateFile, statePaths } from './state.mjs';
import { resolveSpawn } from './tiers.mjs';

const REVIEWER = 'somi-reviewer';
const SECURITY_REVIEWER = 'somi-security-reviewer';
const OBJECT_ID = /^[0-9a-f]{40,64}$/;
const REVIEWER_PROMPT = 'Fresh, read-only review. Run the diff command, read what you need, return only the JSON your instructions define.';
// Judging a diff is judgement work, so the code reviewer runs on medium and the security reviewer on high.
const TIERS = Object.freeze({ [REVIEWER]: 'medium', [SECURITY_REVIEWER]: 'high' });
const bare = (agent) => String(agent ?? '').split(':').pop();

// Who reviews is review policy, so only the user's own config chooses the model, and a committed project config has no say.
const seat = (ctx, agent, diff) => {
  const { tier, model } = resolveSpawn(ctx.configLayers?.[0] ?? {}, ctx.host, TIERS[agent]);
  return { agent: `somi:${agent}`, tier, ...(model ? { model } : {}), brief: `${REVIEWER_PROMPT}\n\nThe diff command:\n${diff}` };
};

const triggers = (signals) => [...signals.review.filter((s) => !RECORDED_ONLY.includes(s)), ...signals.security];

export function readReviews(root, env = process.env) {
  let text;
  try { text = fs.readFileSync(statePaths(root, env).reviews, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  return text.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { throw new StateError('reviews.jsonl has a line that is not JSON; SoMi will not guess at it'); }
  });
}

function baseOf(ctx, base) {
  if (base === undefined || base === null) return workBase(ctx.root);
  try { return resolveRef(ctx.root, base); } catch { throw new ReviewInputError(`cannot find the base ${JSON.stringify(String(base).slice(0, 80))}`); }
}

function signalsFor(ctx, from, to) {
  return computeSignals(readDiff(ctx.root, from, to), ctx.configLayers ?? []);
}

// What this change needs, read from the diff. `always` and `security` come from a user asking, and only ever add a reviewer.
export function reviewPlan(ctx, { base, always = false, security = false } = {}) {
  const from = baseOf(ctx, base);
  const tree = snapshotTree(ctx.root);
  const signals = signalsFor(ctx, from, tree);
  const empty = signals.facts.files === 0;
  const fired = triggers(signals);
  const agents = [];
  // One reviewer per change. When a security signal fired, the security reviewer also reads the change as the code reviewer would, so
  // its attack paths and its defects come from one pass: a second reviewer on the same diff found little the first had not, at about
  // twice the cost.
  if (!empty && (signals.security.length > 0 || security)) agents.push(SECURITY_REVIEWER);
  else if (!empty && (fired.length > 0 || always)) agents.push(REVIEWER);
  // A clean review still vouches for a change until something new fires, so acting on its comments does not pay for it again. A user asking
  // is the exception, and so is an open blocking finding, whose fix needs a look.
  const covered = agents.length > 0 && !always && !security && coveringReview(ctx, tree, agents);
  if (covered && (covered.findings ?? []).filter(isBlocking).length === 0) return { needed: false, covered: true, reviewers: [], required: agents, base: from, tree, signals: fired };
  const diff = reviewDiffCommand(from, tree);
  return { needed: agents.length > 0, reviewers: agents.map((a) => seat(ctx, a, diff)), required: agents, base: from, tree, signals: fired, diff };
}

// Hosts hand reviewers the absolute path of the working copy, and a report is not worth paying for twice over that.
const relativeFile = (root, file) => (typeof file === 'string' && path.isAbsolute(file) && path.relative(root, file) && !path.relative(root, file).startsWith('..') ? path.relative(root, file) : file);

function normalized(ctx, reviews) {
  if (!Array.isArray(reviews)) throw new ReviewInputError('reviews must be an array');
  return reviews.map((r) => (r !== null && typeof r === 'object' && !Array.isArray(r)
    ? { ...r, agent: bare(r.agent), findings: Array.isArray(r.findings) ? r.findings.map((f) => (f !== null && typeof f === 'object' ? { ...f, file: relativeFile(ctx.root, f.file) } : f)) : r.findings }
    : r));
}

const ADVICE = Object.freeze({
  fix: 'These findings block this change from leaving. Fix them where the change was made: if a worker built it, start the same worker with its brief and these findings below it, and otherwise fix them here. Then call somi_review with no reviews, run the reviewers it names, and record what they return. If a finding has needs_verification, check it first: a reviewer asking to remove a check is not enough reason to remove it.',
  fixHere: 'These findings block this change from leaving, and security signals fired on its diff. Fix them here, on this conversation\'s model, and not on a low worker, even if one built the change. Then call somi_review with no reviews, run the reviewers it names, and record what they return. If a finding has needs_verification, check it first: a reviewer asking to remove a check is not enough reason to remove it.',
  ask: 'Tell the user: blocking findings remain after repeated review passes. Show them, and let the user choose between more fixing and stopping. SoMi will not write clean pull request text until a review clears them.',
  close: 'Nothing here blocks the change. Pass the logged findings on to the user briefly, and do not act on them unless the user asks.',
});

export function recordReviews(ctx, { reviews, base, tree: reviewed, always = false, security = false }) {
  const plan = reviewPlan(ctx, { base, always, security });
  const tree = OBJECT_ID.test(String(reviewed)) ? reviewed : plan.tree;
  const list = normalized(ctx, reviews);
  const named = list.map((r) => r?.agent).filter((a) => Object.hasOwn(TIERS, a));
  const dispatched = [...new Set([...plan.required, ...named])].map((agent) => ({ agent }));
  const { findings, verdicts } = parseReviews(list, dispatched);
  const earlier = readReviews(ctx.root, ctx.env).filter((r) => r.base === plan.base);
  const pass = earlier.length + 1;
  const previousBlocking = earlier.at(-1)?.blocking ?? [];
  const decision = decideAfterReview({ findings, pass, previousBlocking });
  const blocking = findings.filter(isBlocking);
  const securityFired = plan.signals.some((s) => SECURITY_SIGNALS.includes(s));
  const record = { v: 1, at: ctx.now(), base: plan.base, tree, pass, verdicts, findings, blocking: blocking.map((f) => f.fingerprint) };
  appendStateFile(ctx.root, statePaths(ctx.root, ctx.env).reviews, `${JSON.stringify(record)}\n`, ctx.env);
  const logged = findings.filter((f) => !isBlocking(f));
  const trimmed = verdicts.filter((v) => v.trimmed).map((v) => ({ agent: v.agent, dropped: v.trimmed }));
  return {
    verdict: decision.next === 'close' ? 'clear' : decision.next === 'fix' ? 'fix' : 'ask-user',
    pass,
    blocking,
    logged,
    advice: decision.next === 'fix' && securityFired ? ADVICE.fixHere : ADVICE[decision.next],
    ...(decision.stop ? { stop: decision.stop } : {}),
    ...(trimmed.length ? { trimmed, trimmed_note: 'These reports were over the size cap, so their least severe findings were dropped to fit. Tell the user how many.' } : {}),
  };
}

// Whether a record still vouches for the tree now. A later change that fires no signal does not undo it. One that does needs its own look.
function covers(ctx, record, tree, needed) {
  if (!OBJECT_ID.test(String(record.tree))) return false;
  const agents = (record.verdicts ?? []).map((v) => bare(v.agent));
  if (!needed.every((a) => agents.includes(a))) return false;
  if (record.tree === tree) return true;
  try { return triggers(signalsFor(ctx, record.tree, tree)).length === 0; } catch { return false; }
}

const coveringReview = (ctx, tree, needed) => [...readReviews(ctx.root, ctx.env)].reverse().find((r) => covers(ctx, r, tree, needed)) ?? null;

// The review gate. Findings are taken from the newest review that covers the tree, so a clean re-review clears an earlier blocker.
export function prGate(ctx, { base } = {}) {
  const plan = reviewPlan(ctx, { base });
  const covering = coveringReview(ctx, plan.tree, plan.required);
  if (!plan.needed && !covering) return { ok: true, plan, review: null };
  if (!covering) return { ok: false, reason: 'not-reviewed', signals: plan.signals, plan, review: null };
  const blocking = (covering.findings ?? []).filter(isBlocking);
  if (blocking.length > 0) return { ok: false, reason: 'open-blocking', blocking, plan, review: covering };
  return { ok: true, plan, review: covering };
}

