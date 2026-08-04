#!/usr/bin/env node
// Scores one run against a task's pass criteria, using a model as the judge.
//
// The criteria are prose — "each option states a cost in a constraint the fixture actually
// supplies", "the finding cites a case that actually reproduces". No regex decides those, and a
// keyword scorer would reproduce this corpus's most-repeated defect at the scoring layer: a check
// that passes for the wrong reason. So the judge is a model, and the design work goes into making
// its verdict auditable rather than into pretending it is deterministic.
//
// Three properties the prompt is built for:
//
//  1. **The judge never sees the fixture's traps as hints.** It gets the task spec (which states
//     the criteria) and the run's evidence. It does NOT get fixtures/README.md.
//  2. **Per-criterion, not per-dimension.** rubric.md's aggregation rule is that a dimension
//     passes iff every criterion tagged with it passes. Asking for a dimension verdict directly
//     would let the judge average, which is exactly the softening the rule forbids.
//  3. **Evidence is quoted back.** Each verdict carries the span it rests on, so a wrong verdict
//     is visible as a wrong quote rather than as an unexplained grade.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const JUDGE_PREAMBLE = `You are scoring one run of an automated coding agent against a fixed set of
pass criteria. You are not evaluating whether the run was good; you are checking each criterion.

Rules:
- Judge ONLY against the criteria given. Do not invent criteria, and do not fail a run for
  something no criterion names.
- A criterion passes only if the evidence positively shows it. Absence of evidence is a fail,
  never a pass — but read the evidence carefully before concluding absence.
- Where a criterion says a specific wrong answer fails, check for that wrong answer explicitly.
- Quote the exact span your verdict rests on. If you cannot quote one, the criterion fails.

Return ONLY a JSON object, no prose around it:
{"criteria":[{"n":1,"verdict":"pass"|"fail","evidence":"<quoted span or why absent>"}]}`;

/**
 * Ask the judge to score one run.
 *
 * Invoked with `--print` from an empty sandbox directory: it reasons over text handed to it, and
 * an empty cwd means a filesystem read finds nothing rather than finding the answer key.
 */
// 300s was too tight and cost a run: the judge reads a full task spec plus a transcript and a
// diff, and one of three scored runs died on ETIMEDOUT. A timed-out judge is worse than a slow
// one -- the agent run that preceded it already cost ~280s, and losing the verdict throws that
// away too.
// Defaults to a SMALL model. The judge is roughly half of every run's wall clock (300-400s of a
// 611s run) and its job is structured extraction against criteria that are already written out --
// not the open-ended reasoning the candidate does. Overridable with --judge-model, and
// `tests/evals/judge-agreement.mjs` measures whether a swap changes any verdict before you trust
// it. Do NOT change this on the strength of it being cheaper.
// REVERTED to the larger model. The first agreement check disagreed on 1 of 6 criterion verdicts
// (task 01 criterion 6: sonnet=fail, haiku=pass -- haiku was the correct one, adjudicated from the
// stored evidence). A cheaper scorer that grades DIFFERENTLY is not a saving; at N=20 one flipped
// verdict in twenty moves a dimension a full grade, and phase 4 would read that as a
// definition-set regression when only the scorer changed.
//
// Revisit once criteria 6 and 3 are executed rather than judged (that removes the criterion this
// disagreement was on) and agreement has been re-measured across ~20 shards rather than one.
export const DEFAULT_JUDGE_MODEL = null;

/**
 * Retries a MALFORMED reply, once.
 *
 * A judge that returns prose instead of JSON discards the ~12-minute agent run that preceded it --
 * the expensive half thrown away because the cheap half stuttered. Observed once in three runs,
 * which at ~90% of a usage cap per batch is not affordable.
 *
 * Only a PARSE failure is retried. A quota outage is not retried (the next call fails identically
 * and burns budget proving it), and neither is a non-zero exit for any other reason.
 */
export function judge(taskSpec, evidence, opts = {}) {
  const first = judgeOnce(taskSpec, evidence, opts);
  if (first.ok || first.quota) return first;
  // Distinguish "the model replied, badly" from "the call failed". Only the former can improve.
  const malformed = /not valid JSON|no JSON object|no criteria array|malformed criterion/.test(first.error ?? '');
  if (!malformed) return first;
  const second = judgeOnce(taskSpec, evidence, { ...opts, retry: true });
  return second.ok ? { ...second, retried: true } : { ...first, retried: true, secondError: second.error };
}

function judgeOnce(taskSpec, evidence, { model = DEFAULT_JUDGE_MODEL, timeoutMs = 900_000, retry = false } = {}) {
  const prompt = [
    JUDGE_PREAMBLE,
    retry ? '\nYour previous reply was not parseable. Return ONLY the JSON object, with no prose,\nno explanation, and no code fence.\n' : '',
    '\n## Task specification (the criteria are numbered under "Pass criteria")\n',
    taskSpec,
    '\n## Evidence from the run\n',
    evidence,
  ].join('\n');

  const args = ['--print', '--permission-mode', 'bypassPermissions'];
  if (model) args.push('--model', model);
  args.push(prompt);

  // Run from a fresh EMPTY directory rather than trying to disable tools. `--allowed-tools ''`
  // looks like the way to say "no tools" and is not: the empty string is consumed as the prompt
  // argument, and the CLI then exits 1 with "Input must be provided". More importantly, an empty
  // cwd is the stronger property -- it does not matter whether the judge can read files if there
  // are none to read, and the thing being kept away from it is the fixture answer key that sits a
  // couple of directories up from most eval layouts.
  const sandbox = mkdtempSync(join(tmpdir(), 'somi-judge-'));
  let res;
  try {
    res = spawnSync('claude', args, {
      encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, cwd: sandbox,
    });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  if (res.status !== 0 || res.error) {
    // Quota is named, not lumped into `judge exited 1`. Without this, a rescore burned four
    // consecutive judge calls against an exhausted limit and reported four indistinguishable
    // errors -- the caller could not tell "wait and retry" from "the reply was malformed".
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    const quota = /session limit|rate limit|usage limit|quota/i.test(out);
    return {
      ok: false,
      quota,
      error: quota ? 'quota exhausted' : (res.error ? String(res.error.message ?? res.error) : `judge exited ${res.status}`),
      raw: res.stdout ?? '',
    };
  }
  return parseVerdict(res.stdout ?? '');
}

/**
 * Extract the verdict object from the judge's reply.
 *
 * Fails loudly rather than defaulting. A judge reply that cannot be parsed must not silently
 * become "all criteria failed" — that would look like a definition-set regression in phase 4 when
 * what actually happened is that the scorer broke.
 */
export function parseVerdict(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fence ? fence[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return { ok: false, error: 'no JSON object in judge reply', raw: text.slice(0, 400) };
  let parsed;
  try { parsed = JSON.parse(body.slice(start, end + 1)); }
  catch (err) { return { ok: false, error: `judge reply is not valid JSON: ${err.message}`, raw: text.slice(0, 400) }; }
  if (!Array.isArray(parsed.criteria) || parsed.criteria.length === 0) {
    return { ok: false, error: 'judge reply has no criteria array', raw: text.slice(0, 400) };
  }
  for (const c of parsed.criteria) {
    if (!Number.isInteger(c.n) || (c.verdict !== 'pass' && c.verdict !== 'fail')) {
      return { ok: false, error: `malformed criterion entry: ${JSON.stringify(c).slice(0, 120)}`, raw: text.slice(0, 400) };
    }
  }
  return { ok: true, criteria: parsed.criteria };
}

/**
 * Map per-criterion verdicts onto dimensions, per rubric.md: a dimension passes iff EVERY
 * criterion tagged with it passes.
 *
 * `tags` comes from the task spec's own criterion list, so the mapping is read from the document
 * that defines it rather than duplicated here — the drift this work item exists to remove.
 */
export function toDimensions(criteria, tags) {
  const dims = {};
  for (const { n, verdict } of criteria) {
    for (const dim of tags[n] ?? []) {
      // A single failing criterion fails the dimension, regardless of order or of how many
      // other criteria carry the same tag. No averaging.
      dims[dim] = (dims[dim] ?? true) && verdict === 'pass';
    }
  }
  return dims;
}

/** Read `N. **Sx — ...` criterion headers out of a task spec to get {criterionNumber: [dims]}. */
export function criterionTags(taskSpec) {
  const tags = {};
  const section = taskSpec.split(/^## Pass criteria$/m)[1] ?? taskSpec;
  for (const m of section.matchAll(/^(\d+)\.\s+\*\*(S[1-7])\b/gm)) {
    (tags[Number(m[1])] ??= []).push(m[2]);
  }
  return tags;
}
