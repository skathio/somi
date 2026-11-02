// engine.mjs: the step engine. The coordinator gives it a request and then the result of each step, and every answer names one next
// action and says how to carry it out, so the procedure lives here and not in anyone's prompt. It sits on the kernel: the kernel owns
// a milestone's check, signals, review and close, and the engine decides who does each piece of work and on which tier.
//
// Escalation restarts: a fresh worker one tier up gets the working tree and a short summary, never the previous transcript, because
// continuing a cheap model's run on a strong one recovers less of the quality gap than starting clean. It happens at most once per route.

import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_VERSION, appendEvent, deriveCursor, readEvents, writeCursor } from './journal.mjs';
import { readLedger, addToLedger } from './ledger.mjs';
import { TransitionError, afterCode, afterReview, close as kernelClose, decide as kernelDecide, open as kernelOpen } from './kernel.mjs';
import { isBlocking } from './policy.mjs';
import { classify } from './routes.mjs';
import { shardsFor } from './shards.mjs';
import { nextTier, resolveSpawn } from './tiers.mjs';
import { renderStatus } from './views.mjs';
import { WORKER, WORKFLOWS, libraryPath, workerPrompt } from './workflows.mjs';

const MAX_REQUEST = 8192;
const STILL_FAILING_AFTER = 3;
const SECOND_FIX = 2;
const CLI = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'somi.mjs');
const somiCommand = (args) => `node ${JSON.stringify(CLI)} ${args}`;
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
const shellQuote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;

const HOW = Object.freeze({
  spawn: 'Start spawn.agent with spawn.model if one is given, passing spawn.prompt unchanged. Do nothing else. When it reports, call somi_step with action "done", status "ok" (or "too-big" with milestones, or "blocked") and its summary.',
  review: 'Start each listed reviewer as a fresh agent with its model, giving it only card.diff and card.prompt. Then call somi_step with action "after-review" and every reviewer\'s JSON.',
  critic: 'Start spawn.agent with spawn.model, passing spawn.prompt unchanged. Then call somi_step with action "done", status "ok" and keep set to the ids it confirmed.',
  run: 'Run this one shell command, then call somi_step with the action in `then`.',
  ask: 'Show the maintainer the question and end your turn. When they answer, call somi_step with action "decide", their words as text, and then set to continue, close or abort.',
  choose: 'Pick the route that best fits the request from choices, then call somi_step with action "route", the same request, and hint set to it.',
  report: 'Relay this to the maintainer briefly. Add nothing of your own.',
  done: 'Tell the maintainer the outcome in one or two sentences, from summary. The work is finished.',
});

function record(ctx, body) {
  const events = readEvents(ctx.root, ctx.env);
  const event = clean({ v: SCHEMA_VERSION, seq: events.length + 1, ts: ctx.now(), ...body });
  appendEvent(ctx.root, event, ctx.env);
  writeCursor(ctx.root, deriveCursor([...events, event]), ctx.env);
  return event;
}

const lastRoute = (events) => [...events].reverse().find((e) => e.type === 'route');
const firstLine = (text) => String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 80) || 'Requested work';

function spawnWorker(ctx, c, { note, request, tier = c.tier } = {}) {
  const events = readEvents(ctx.root, ctx.env);
  const wf = WORKFLOWS[c.route];
  const { model, enforced, tier: actual } = resolveSpawn(ctx.config, ctx.host, tier);
  const start = shardsFor({ root: ctx.root, step: 'work-item.start', env: ctx.env });
  const opening = events.filter((e) => e.type === 'open').length <= 1 && !note;
  const prompt = workerPrompt({
    role: wf.role, request: request ?? lastRoute(events)?.request, ledger: readLedger(ctx.root, ctx.env), skills: wf.skills ?? [], note,
    shards: opening ? start.usable : [],
  });
  return clean({
    route: c.route, milestone: c.milestone, next: 'spawn', how: HOW.spawn,
    spawn: clean({ agent: wf.agent ?? WORKER, tier: actual, model, enforced: enforced ? undefined : false, prompt }),
    notice: opening && start.skipped.length > 0 ? `Skipped connected steps: ${start.skipped.map((b) => `${b.ref} (${b.state})`).join(', ')}` : undefined,
  });
}

function closeStep(ctx, c) {
  const title = c.title ?? firstLine(lastRoute(readEvents(ctx.root, ctx.env))?.request);
  return {
    route: c.route, milestone: c.milestone, next: 'run', how: HOW.run, then: 'close',
    run: `git add -A -- . ':(exclude).somi' && (git diff --cached --quiet || git commit -q -m ${shellQuote(title)})`,
  };
}

function finish(ctx, outcome, summary) {
  const c = deriveCursor(readEvents(ctx.root, ctx.env));
  record(ctx, { key: `finish:${c.seq + 1}`, type: 'finish', route: c.route, outcome });
  return clean({ next: 'done', how: HOW.done, route: c.route, outcome, summary });
}

function startMilestone(ctx, c) {
  const { milestones, index } = c.lane;
  const title = milestones[index];
  kernelOpen(ctx, { title: title.slice(0, 120), releaseCandidate: true });
  const after = deriveCursor(readEvents(ctx.root, ctx.env));
  addToLedger(ctx.root, { kind: 'pointer', text: `milestone ${index + 1} of ${milestones.length}: ${title.slice(0, 120)}` }, ctx.env);
  const request = lastRoute(readEvents(ctx.root, ctx.env))?.request;
  return spawnWorker(ctx, after, {
    request: `${title}\n\nThis is milestone ${index + 1} of ${milestones.length} of: ${firstLine(request)}`,
    note: 'Do this milestone only, on top of the work already in the tree. A plan is in `.somi/plan.md` if you need the larger picture.',
  });
}

function fromKernel(ctx, r) {
  const c = deriveCursor(readEvents(ctx.root, ctx.env));
  if (r.refused === 'check-required') return { route: c.route, milestone: c.milestone, next: 'run', how: HOW.run, then: 'done', run: somiCommand('check') };
  if (r.refused === 'nothing-changed') return spawnWorker(ctx, c, { note: `The last attempt changed nothing. Still to fix:\n${JSON.stringify(r.findings ?? [])}` });
  if (r.next === 'ask') return clean({ route: c.route, milestone: c.milestone, next: 'ask', how: HOW.ask, question: r.question, stop: r.stop });
  if (r.next === 'close') return closeStep(ctx, c);
  if (r.next === 'review') {
    const reviewers = r.reviewers.map((x) => clean({ agent: `somi:${x.agent}`, tier: x.tier, model: x.model }));
    return clean({ route: c.route, milestone: c.milestone, next: 'review', how: HOW.review, reviewers, card: r.card, signals: r.signals, security: r.security });
  }
  return null;
}

function afterFailedCheck(ctx, c, failed) {
  const events = readEvents(ctx.root, ctx.env);
  const fails = events.filter((e) => e.type === 'check' && e.milestone === c.milestone && !e.ok).length;
  const note = `The checks failed:\n${JSON.stringify(failed ?? [])}\nFix what they report.`;
  if (fails >= STILL_FAILING_AFTER) {
    record(ctx, { key: `halt:${c.milestone}:${fails}`, type: 'halt', milestone: c.milestone, next: 'ask', stop: 'still-failing', question: `The checks have failed ${fails} times, and a stronger model has already tried. Continue, or stop here?` });
    return { route: c.route, milestone: c.milestone, next: 'ask', how: HOW.ask, question: `The checks have failed ${fails} times, and a stronger model has already tried. Continue, or stop here?`, stop: 'still-failing' };
  }
  const up = fails >= 2 && !c.escalated ? nextTier(ctx.config, c.tier) : null;
  if (up) {
    record(ctx, { key: `escalate:${c.seq + 1}`, type: 'escalate', from: c.tier, tier: up, reason: 'checks failed twice' });
    return spawnWorker(ctx, deriveCursor(readEvents(ctx.root, ctx.env)), { note: `An earlier attempt left its work in the tree, and it may be wrong. Judge it fresh. ${note}` });
  }
  return spawnWorker(ctx, c, { note });
}

export function route(ctx, { request, ticket, hint }) {
  if (typeof request !== 'string' || request.trim() === '') throw new TransitionError('route needs the request');
  const c = deriveCursor(readEvents(ctx.root, ctx.env));
  const chosen = classify({ request, ticket, hint });
  if (chosen.via === 'choose') return { next: 'choose', how: HOW.choose, choices: chosen.choices };
  if (chosen.route === 'status') return { next: 'report', how: HOW.report, status: renderStatus(readEvents(ctx.root, ctx.env)) };
  if (chosen.route === 'config') {
    return { next: 'report', how: HOW.report, tiers: Object.fromEntries(['low', 'medium', 'high'].map((t) => [t, resolveSpawn(ctx.config, ctx.host, t)])), host: ctx.host };
  }
  if (c.route && chosen.route !== 'resume') {
    return { next: 'report', how: HOW.report, open: clean({ route: c.route, milestone: c.milestone, title: c.title }), note: 'That work is still open. Ask the maintainer to resume it or abandon it; use action "resume" or "abandon".' };
  }
  if (chosen.route === 'resume') return resume(ctx);
  const wf = WORKFLOWS[chosen.route];
  record(ctx, { key: `route:${c.seq + 1}`, type: 'route', route: chosen.route, via: chosen.via, tier: wf.tier, request: request.slice(0, MAX_REQUEST) });
  const now = deriveCursor(readEvents(ctx.root, ctx.env));
  if (wf.kind === 'command') return { route: chosen.route, next: 'run', how: HOW.run, then: 'done', run: `${somiCommand('check --full')} && ${somiCommand('pr')}` };
  if (wf.kind === 'code') {
    kernelOpen(ctx, { title: firstLine(request), releaseCandidate: Boolean(wf.alwaysReview) });
    return spawnWorker(ctx, deriveCursor(readEvents(ctx.root, ctx.env)));
  }
  return spawnWorker(ctx, now);
}

export function resume(ctx) {
  const c = deriveCursor(readEvents(ctx.root, ctx.env));
  if (!c.route) return { next: 'report', how: HOW.report, note: 'Nothing is open.' };
  if (c.awaiting === 'plan-approval') return { route: c.route, next: 'ask', how: HOW.ask, question: 'The plan in .somi/plan.md is waiting for approval. Continue with it, or stop?' };
  if (c.next === 'ask') return clean({ route: c.route, next: 'ask', how: HOW.ask, question: c.question, stop: c.stop });
  if (c.next === 'close') return closeStep(ctx, c);
  if (c.milestone === null) return spawnWorker(ctx, c);
  return spawnWorker(ctx, c, { note: 'Earlier work on this is in the tree. Continue from there.' });
}

export function abandon(ctx) {
  const c = deriveCursor(readEvents(ctx.root, ctx.env));
  if (!c.route) return { next: 'report', how: HOW.report, note: 'Nothing is open.' };
  if (c.milestone) record(ctx, { key: `close:${c.milestone}`, type: 'close', milestone: c.milestone, outcome: 'abandoned' });
  return finish(ctx, 'abandoned');
}

const PLAN_STEP = /^\s*(?:#{1,6}\s*)?(?:\d+[.)]\s+|[-*]\s+)?(?:milestone\b[^:]*:\s*)(.+)$/i;
const NUMBERED = /^\s*\d+[.)]\s+(.+)$/;
export function parseMilestones(text) {
  const lines = String(text).split('\n');
  const named = lines.map((l) => PLAN_STEP.exec(l)?.[1]).filter(Boolean);
  const list = named.length > 0 ? named : lines.map((l) => NUMBERED.exec(l)?.[1]).filter(Boolean);
  return list.map((s) => s.trim());
}

function planReady(ctx, c, milestones) {
  record(ctx, { key: `plan:${c.seq + 1}`, type: 'plan', milestones, awaiting: 'plan-approval' });
  return { route: c.route, next: 'ask', how: HOW.ask, question: `The plan has ${milestones.length} milestones:\n${milestones.map((m, i) => `${i + 1}. ${m}`).join('\n')}\nContinue with it, or stop?`, milestones };
}

export function done(ctx, { status = 'ok', summary, milestones, keep } = {}) {
  const c = deriveCursor(readEvents(ctx.root, ctx.env));
  if (!c.route) throw new TransitionError('nothing is open');
  const wf = WORKFLOWS[c.route];
  if (c.awaiting === 'critic') return afterCritic(ctx, c, keep);
  if (status === 'blocked') {
    if (c.milestone) record(ctx, { key: `halt:${c.milestone}:${c.seq + 1}`, type: 'halt', milestone: c.milestone, next: 'ask', stop: 'worker-blocked', question: String(summary ?? 'The worker could not continue.').slice(0, 800) });
    return { route: c.route, next: 'ask', how: HOW.ask, question: String(summary ?? 'The worker could not continue.').slice(0, 800), stop: 'worker-blocked' };
  }
  if (status === 'too-big' && wf.kind === 'code') {
    const parts = Array.isArray(milestones) ? milestones.map(String).filter(Boolean) : parseMilestones(summary);
    if (parts.length > 1) {
      if (c.milestone) record(ctx, { key: `close:${c.milestone}`, type: 'close', milestone: c.milestone, outcome: 'split' });
      return planReady(ctx, deriveCursor(readEvents(ctx.root, ctx.env)), parts);
    }
  }
  if (wf.kind === 'plan' && !c.lane) {
    let text = '';
    try { text = fs.readFileSync(path.join(ctx.root, '.somi', 'plan.md'), 'utf8'); } catch { /* reported below */ }
    const parts = parseMilestones(text);
    if (parts.length === 0) return { route: c.route, next: 'ask', how: HOW.ask, question: 'The planner left no milestones in .somi/plan.md. Retry, or stop?' };
    return planReady(ctx, c, parts);
  }
  if (wf.kind === 'report' || wf.kind === 'command') {
    const shards = shardsFor({ root: ctx.root, step: wf.kind === 'command' ? 'pr.open' : 'review.done', env: ctx.env });
    const writes = [...shards.usable, ...shards.held].filter((b) => b.mode === 'write');
    const result = finish(ctx, 'done', summary);
    if (writes.length > 0) result.confirm = `Connected steps want to write outward: ${writes.map((b) => b.ref).join(', ')}. Run them only after the maintainer confirms.`;
    return result;
  }
  const r = afterCode(ctx);
  if (r.check?.ok === false) return afterFailedCheck(ctx, c, r.check.failed);
  const mapped = fromKernel(ctx, r);
  if (mapped) return mapped;
  return spawnWorker(ctx, c, { note: 'Continue the work.' });
}

function afterCritic(ctx, c, keep) {
  const held = [...readEvents(ctx.root, ctx.env)].reverse().find((e) => e.type === 'critic');
  const confirmed = new Set(Array.isArray(keep) ? keep : []);
  // A critic can only remove a finding from what re-loops. It stays in the record as a logged note, and Blockers are not its to clear.
  const reviews = held.reviews.map((rv) => ({ ...rv, findings: (rv.findings ?? []).map((f) => (f.severity === 'Major' && f.boundary && !confirmed.has(f.id) ? { ...f, boundary: false, disputed: true } : f)) }));
  record(ctx, { key: `critic-done:${c.seq + 1}`, type: 'critic', reviews: undefined, done: true });
  return reviewedStep(ctx, reviews);
}

function reviewedStep(ctx, reviews) {
  const r = afterReview(ctx, { reviews });
  const c = deriveCursor(readEvents(ctx.root, ctx.env));
  if (r.next === 'fix') {
    const fixes = readEvents(ctx.root, ctx.env).filter((e) => e.type === 'after-review' && e.milestone === c.milestone && e.next === 'fix').length;
    const note = `A reviewer found these. Fix each one, and weigh any that asks to remove a check against the threat model first:\n${JSON.stringify(r.findings ?? [])}`;
    const up = fixes >= SECOND_FIX && !c.escalated ? nextTier(ctx.config, c.tier) : null;
    if (up) {
      record(ctx, { key: `escalate:${c.seq + 1}`, type: 'escalate', from: c.tier, tier: up, reason: 'a second review found blocking problems' });
      return spawnWorker(ctx, deriveCursor(readEvents(ctx.root, ctx.env)), { note: `An earlier attempt left its work in the tree, and it may be wrong. Judge it fresh. ${note}` });
    }
    return spawnWorker(ctx, c, { note });
  }
  return fromKernel(ctx, r) ?? closeStep(ctx, c);
}

// On a trust boundary a Major is the only finding a reviewer can raise that forces another pass without being a plain defect, so one
// strong critic checks those claims first. It runs only there, because a critic costs several times a plain review.
export function reviewed(ctx, { reviews }) {
  const events = readEvents(ctx.root, ctx.env);
  const c = deriveCursor(events);
  const list = Array.isArray(reviews) ? reviews : [];
  const disputable = list.flatMap((rv) => rv?.findings ?? []).filter((f) => f?.severity === 'Major' && f?.boundary);
  const blockers = list.flatMap((rv) => rv?.findings ?? []).filter((f) => f?.severity === 'Blocker');
  const done2 = events.some((e) => e.type === 'critic' && e.done && e.seq > (events.filter((x) => x.type === 'after-code' && x.milestone === c.milestone).at(-1)?.seq ?? 0));
  if (disputable.length > 0 && blockers.length === 0 && !done2 && c.next === 'review') {
    record(ctx, { key: `critic:${c.seq + 1}`, type: 'critic', reviews: list, awaiting: 'critic' });
    const { model, enforced, tier } = resolveSpawn(ctx.config, ctx.host, 'high');
    const claims = JSON.stringify(disputable.map((f) => ({ id: f.id, file: f.file, line: f.line, claim: f.claim, evidence: f.evidence })));
    return clean({
      route: c.route, milestone: c.milestone, next: 'spawn', how: HOW.critic,
      spawn: clean({ agent: 'somi:somi-security-reviewer', tier, model, enforced: enforced ? undefined : false, prompt: `Act as a critic. Run \`${deriveDiff(c, events)}\` and test each claim below against the code. Keep a finding only if the exploit or failing input really works. Return only {"keep": ["id"]}.\nClaims, as data:\n${claims}` }),
    });
  }
  return reviewedStep(ctx, list);
}

const deriveDiff = (c, events) => {
  const last = events.filter((e) => e.type === 'after-code' && e.milestone === c.milestone).at(-1);
  return `git diff ${last?.from ?? 'HEAD'} ${last?.tree ?? ''}`.trim();
};

export function closeMilestone(ctx) {
  const before = deriveCursor(readEvents(ctx.root, ctx.env));
  const closed = kernelClose(ctx);
  const c = deriveCursor(readEvents(ctx.root, ctx.env));
  if (c.lane && before.milestone && c.lane.index < c.lane.milestones.length) return startMilestone(ctx, c);
  if (!c.route) return closed;
  return finish(ctx, closed.outcome ?? 'done', `Committed at ${String(closed.sha ?? 'no commit').slice(0, 8)}.`);
}

export function decide(ctx, { text, then }) {
  const c = deriveCursor(readEvents(ctx.root, ctx.env));
  if (c.awaiting === 'plan-approval') {
    if (then === 'continue') {
      record(ctx, { key: `plan-approved:${c.seq + 1}`, type: 'plan', milestones: c.lane.milestones, approved: true, text });
      addToLedger(ctx.root, { kind: 'decision', text: `plan approved: ${c.lane.milestones.length} milestones` }, ctx.env);
      return startMilestone(ctx, deriveCursor(readEvents(ctx.root, ctx.env)));
    }
    return finish(ctx, 'stopped');
  }
  if (c.milestone === null) {
    if (then === 'continue' && c.route) return spawnWorker(ctx, c, { note: `The maintainer said: ${text}` });
    return c.route ? finish(ctx, 'stopped') : { next: 'report', how: HOW.report, note: 'Nothing is waiting for an answer.' };
  }
  const r = kernelDecide(ctx, { text, then });
  try { addToLedger(ctx.root, { kind: 'decision', text }, ctx.env); } catch { /* a full ledger must not block the answer; the journal holds it */ }
  const after = deriveCursor(readEvents(ctx.root, ctx.env));
  if (r.next === 'close') return closeStep(ctx, after);
  return spawnWorker(ctx, after, { note: `The maintainer said: ${text}` });
}

export const skillPath = (name) => libraryPath('skills', name);
export { isBlocking };
