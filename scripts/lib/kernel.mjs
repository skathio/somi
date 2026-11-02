// kernel.mjs: the state machine. One function per transition, one journal event per transition, and every response names only
// the next action. All state writes happen here, so no flow text ever asks a model to edit a file.
//
// Replay: a transition that was already recorded returns its stored response and appends nothing. A model retrying after a crash
// or a lost response therefore cannot double-count a pass.

import { SCHEMA_VERSION, appendEvent, deriveCursor, readEvents, writeCursor } from './journal.mjs';
import { MAX_PASSES, decideAfterReview, isBlocking, parseReviews } from './policy.mjs';
import { computeSignals } from './signals.mjs';
import { baseRef, headSha, readDiff, reviewDiffCommand, snapshotTree } from './git-tree.mjs';
import { resolveSpawn } from './tiers.mjs';

export const MAX_RESPONSE_BYTES = 2560;
export class TransitionError extends Error {}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
const REVIEWER_PROMPT = 'Fresh, read-only review. Run the diff command, read what you need, return only the JSON your instructions define.';

function record(ctx, events, body) {
  const event = clean({ v: SCHEMA_VERSION, seq: events.length + 1, ts: ctx.now(), ...body });
  appendEvent(ctx.root, event, ctx.env);
  writeCursor(ctx.root, deriveCursor([...events, event]), ctx.env);
  return event;
}

const lastOf = (events, test) => [...events].reverse().find(test);

function cap(response) {
  if (Buffer.byteLength(JSON.stringify(response)) <= MAX_RESPONSE_BYTES) return response;
  const short = { ...response };
  if (Array.isArray(short.findings)) { short.more_findings = short.findings.length - 3; short.findings = short.findings.slice(0, 3); }
  if (short.card?.files) short.card = { ...short.card, more_files: short.card.files.length - 10, files: short.card.files.slice(0, 10) };
  return short;
}

const openResponse = (e) => clean({ milestone: e.milestone, next: e.next, stop: e.stop, question: e.question });

export function open(ctx, { title, ask, followUp, releaseCandidate = false }) {
  if (typeof title !== 'string' || title.trim() === '') throw new TransitionError('open needs a title');
  const events = readEvents(ctx.root, ctx.env);
  const c = deriveCursor(events);
  if (c.milestone !== null) {
    if (c.title === title) return openResponse(events.find((e) => e.key === `open:${c.milestone}`));
    throw new TransitionError(`${c.milestone} is still open; close it first`);
  }
  const opened = events.filter((e) => e.type === 'open');
  const milestone = `m${opened.length + 1}`;
  let stop; let question;
  if (ask) { stop = 'intent-gate'; question = ask; }
  else if (followUp && opened.some((e) => e.follow_up === followUp)) { stop = 'area-follow-up'; question = `This is the second follow-up in ${followUp}. Continue, or stop and rethink the area?`; }
  return openResponse(record(ctx, events, {
    key: `open:${milestone}`, type: 'open', milestone, title, base: baseRef(ctx.root), next: stop ? 'ask' : 'code', stop, question,
    follow_up: followUp, release_candidate: releaseCandidate || undefined,
  }));
}

function reviewersFor(ctx, security) {
  const seat = (agent, wanted) => { const { tier, model } = resolveSpawn(ctx.config, ctx.host, wanted); return clean({ agent, tier, model }); };
  return [seat('somi-reviewer', 'low'), ...(security ? [seat('somi-security-reviewer', 'high')] : [])];
}

const afterCodeResponse = (e) => cap(clean({
  milestone: e.milestone, next: e.next, stop: e.stop, question: e.question, signals: e.signals, security: e.security,
  reviewers: e.next === 'review' ? e.reviewers : undefined,
  card: e.next === 'review' ? { diff: reviewDiffCommand(e.from, e.tree), files: e.files, scope: e.scope, prompt: REVIEWER_PROMPT } : undefined,
}));

// `runCheck` is present on the CLI path only. MCP servers run outside the OS sandbox, so that path must never execute project
// commands: it reads a check result recorded from inside the sandbox, or refuses.
export function afterCode(ctx, { runCheck, recheck = false } = {}) {
  let events = readEvents(ctx.root, ctx.env);
  let c = deriveCursor(events);
  if (c.milestone === null) throw new TransitionError('no milestone is open');
  if (c.next === 'ask') throw new TransitionError('waiting for the maintainer; record the answer with decide');

  const tree = snapshotTree(ctx.root);
  // Asked to fix, with nothing changed: answering from the earlier run would send the same code back to review.
  if (c.next === 'fix' && c.reviewed_tree === tree) return { milestone: c.milestone, next: 'fix', refused: 'nothing-changed', findings: lastOf(events, (e) => e.type === 'after-review' && e.milestone === c.milestone)?.findings.filter(isBlocking).map((f) => clean({ id: f.id, file: f.file, line: f.line, claim: f.claim })) };

  const latestForTree = lastOf(events, (e) => e.type === 'after-code' && e.milestone === c.milestone && e.tree === tree);
  if (latestForTree && c.tree === tree && c.next !== 'code' && !recheck) return afterCodeResponse(latestForTree);

  const checkFor = () => lastOf(events, (e) => e.type === 'check' && e.tree === tree);
  if (runCheck && (recheck || !checkFor()?.ok)) {
    runCheck(tree);
    events = readEvents(ctx.root, ctx.env);
    c = deriveCursor(events);
  }
  const check = checkFor();
  if (!check) return { milestone: c.milestone, next: c.next, refused: 'check-required', run: 'somi check' };
  if (!check.ok) return { milestone: c.milestone, next: c.next === 'code' ? 'code' : 'fix', check: { ok: false, failed: check.failed } };

  const from = c.reviewed_tree ?? c.base;
  const whole = readDiff(ctx.root, c.base, tree);
  // Routing reads the whole milestone, so a boundary touched before a fix keeps its lens. The reviewer reads only the fix diff.
  const signals = computeSignals(whole, ctx.configLayers);
  const wantsReview = c.reviewed_tree !== tree && (c.next === 'fix' || signals.review.length + signals.security.length > 0 || c.release_candidate);
  const attempt = events.filter((e) => e.type === 'after-code' && e.milestone === c.milestone).length + 1;
  const base = {
    key: `after-code:${c.milestone}:${attempt}`, type: 'after-code', milestone: c.milestone, pass: c.pass, tree, from,
    signals: signals.review, security: signals.security, facts: signals.facts, reviewers: [],
  };
  if (!wantsReview) return afterCodeResponse(record(ctx, events, { ...base, next: 'close' }));
  if (c.pass >= MAX_PASSES + c.extra_passes) {
    return afterCodeResponse(record(ctx, events, { ...base, next: 'ask', stop: 'max-passes', question: `${c.pass} review passes ran and the code changed again. Allow one more pass, or close as it is?` }));
  }
  const scoped = from === c.base ? whole : readDiff(ctx.root, from, tree);
  return afterCodeResponse(record(ctx, events, {
    ...base, next: 'review', reviewers: reviewersFor(ctx, signals.security.length > 0), scope: from === c.base ? 'milestone' : 'fix-only',
    files: scoped.rows.map((r) => r.file).slice(0, 40),
  }));
}

const reviewResponse = (e) => {
  const blockers = e.findings.filter(isBlocking);
  return cap(clean({
    milestone: e.milestone, next: e.next, pass: e.pass, stop: e.stop, question: e.question,
    verify_first: blockers.some((f) => f.needs_verification) ? 'A finding asks to remove a check, flag, validation or test. Check it against the threat model before acting.' : undefined,
    findings: e.next === 'close' ? undefined : blockers.map((f) => clean({ id: f.id, severity: f.severity, file: f.file, line: f.line, claim: f.claim, needs_verification: f.needs_verification })),
    logged: e.findings.length - blockers.length,
  }));
};

export function afterReview(ctx, { reviews }) {
  const events = readEvents(ctx.root, ctx.env);
  const c = deriveCursor(events);
  if (c.milestone === null) throw new TransitionError('no milestone is open');
  if (c.next !== 'review') {
    const prior = events.find((e) => e.key === `after-review:${c.milestone}:${c.pass}`);
    if (prior) return reviewResponse(prior);
    throw new TransitionError(`no review is pending; the next action is ${c.next}`);
  }
  const pass = c.pass + 1;
  const { findings, verdicts } = parseReviews(reviews, c.reviewers);
  const decision = decideAfterReview({ findings, pass, extraPasses: c.extra_passes, previousBlocking: c.blocking });
  return reviewResponse(record(ctx, events, {
    key: `after-review:${c.milestone}:${pass}`, type: 'after-review', milestone: c.milestone, pass, tree: c.tree, verdicts, findings, ...decision,
  }));
}

const THEN = ['continue', 'close', 'abort'];

export function decide(ctx, { text, then }) {
  if (typeof text !== 'string' || text.trim() === '') throw new TransitionError('decide needs the maintainer\'s words');
  if (!THEN.includes(then)) throw new TransitionError('decide takes then: continue, close or abort');
  const events = readEvents(ctx.root, ctx.env);
  const c = deriveCursor(events);
  const decisions = events.filter((e) => e.type === 'decide' && e.milestone === c.milestone);
  if (c.next !== 'ask') {
    const last = decisions.at(-1);
    if (last?.text === text) return { milestone: last.milestone, next: last.next };
    throw new TransitionError('nothing is waiting for the maintainer');
  }
  const grantsPass = then === 'continue' && (c.stop === 'max-passes' || c.stop === 'recurring-finding');
  const next = then !== 'continue' ? 'close' : grantsPass ? 'fix' : 'code';
  const e = record(ctx, events, {
    key: `decide:${c.milestone}:${decisions.length + 1}`, type: 'decide', milestone: c.milestone, text, then, answered: c.stop, next, grants_pass: grantsPass || undefined,
  });
  return { milestone: e.milestone, next: e.next };
}

export function close(ctx) {
  const events = readEvents(ctx.root, ctx.env);
  const c = deriveCursor(events);
  if (c.milestone === null) {
    const last = lastOf(events, (e) => e.type === 'close');
    if (last) return clean({ milestone: last.milestone, next: 'open', sha: last.sha, outcome: last.outcome });
    throw new TransitionError('no milestone is open');
  }
  if (c.next !== 'close') throw new TransitionError(`cannot close yet; the next action is ${c.next}`);
  const answer = lastOf(events, (e) => e.type === 'decide' && e.milestone === c.milestone);
  const outcome = answer?.then === 'abort' ? 'aborted' : answer?.then === 'close' ? 'closed-by-maintainer' : 'done';
  const e = record(ctx, events, { key: `close:${c.milestone}`, type: 'close', milestone: c.milestone, outcome, sha: headSha(ctx.root) });
  return clean({ milestone: e.milestone, next: 'open', sha: e.sha, outcome });
}

// A repeated result for one tree appends nothing, so re-running a check on unchanged code leaves the journal as it was.
export function recordCheck(ctx, { tree, ok, failed, full = false }) {
  const events = readEvents(ctx.root, ctx.env);
  const c = deriveCursor(events);
  if (c.milestone === null) return;
  const forTree = events.filter((e) => e.type === 'check' && e.milestone === c.milestone && e.tree === tree);
  if (forTree.at(-1)?.ok === ok && Boolean(forTree.at(-1)?.full) === full) return;
  record(ctx, events, { key: `check:${c.milestone}:${tree}:${forTree.length + 1}`, type: 'check', milestone: c.milestone, tree, ok, failed, full: full || undefined });
}

export function status(ctx) {
  const c = deriveCursor(readEvents(ctx.root, ctx.env));
  return c.milestone === null ? { next: 'open' } : clean({ milestone: c.milestone, title: c.title, next: c.next, pass: c.pass, stop: c.stop, question: c.question });
}
