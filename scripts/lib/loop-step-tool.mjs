// loop-step-tool.mjs -- the somi_loop tool: the composite loop steps (lib/loop-step.mjs) behind one MCP tool. This file owns
// what the CLI adapter (somi-loop.mjs `step`) does for a shell: pick the root, build the context, map the response onto a tool
// result. The caller supplies `resolveRoot(projectDirArg)` (the server's roots/list lookup), the process env and the install root.
//
// Root: a write step needs a root the HOST supplied (CLAUDE_PROJECT_DIR or MCP roots), else 67 and a pointer to the CLI; `status`
// alone may read a model-supplied project_dir. The root is resolved once per call; project_dir can only select inside a host root
// (resolveProjectRoot's rule) and two host roots without a project_dir are ambiguous (67). A write step also refuses a state
// directory that is a link. Env: only the variables named in PASSED_ENV reach the engine, so a cap set in the server's own
// environment is inert (arguments only tighten, raising is the CLI's); `now` is the server clock.
// Result: one shape for every outcome, the engine's JSON response (a refusal made here is the same shape). `isError` is true
// exactly for a refusal: any nonzero `exit` that is not a gate stop (GATE_STOPS). Lines in `unwritten` are a normal result, a failed
// write included: the caller writes them itself, and a repeat replays the stored result without retrying the write.

import path from 'node:path';
import { EXIT_PROJECT_ENV, EXIT_USAGE } from './dispatch-resolver.mjs';
import { FIELDS, runStep } from './loop-step.mjs';
import { base, clean, GATE_STOPS, stepLog } from './loop-step-kit.mjs';
import { plainDir } from './loop-notes.mjs';

// The server's environment variables the engine may read: where the global config is, and the operator settings that apply as they
// do on the CLI (review mode and scope, severity floor; set at launch, they can loosen a loop as well as tighten it). The cap
// variables (max passes, diff cap) are left out: only the CLI raises a cap, and a tool argument can only lower one.
export const PASSED_ENV = ['SOMI_GLOBAL_CONFIG', 'XDG_CONFIG_HOME', 'APPDATA', 'SOMI_CODE_LOOP_REVIEW', 'SOMI_CODE_LOOP_REVIEW_SCOPE', 'SOMI_CODE_LOOP_SEVERITY_FLOOR', 'SOMI_PLAN_LOOP_SEVERITY_FLOOR'];

export const LOOP_TOOL = {
  name: 'somi_loop',
  description:
    'Run one bounded-loop (/code-loop, /plan-loop) transition and return its JSON result. step: open (start or resume a pass, with the run ' +
    'card; a code loop needs files), after-code (agent that ran; diff gate), after-review ' +
    '(reviewers, verdict, blockers, majors, findings, review file, fixed ids), close (status done or stopped-<reason>), status ' +
    '(read only). The result names the `next` call, what it `wrote` and the records left `unwritten` (file, kind, a summary `line`): record each in its file yourself; ' +
    'a repeated call replays the stored result and does not retry a write. A fired gate is a result with `exit` and `stop_reason` (2 max ' +
    'passes, 3 diff cap, 4 time budget, 5 circuit breaker). Any other nonzero `exit` is a refusal (isError): 64 bad arguments, ' +
    '65/66 agent, 67 no host project root (use the CLI) or an unreadable config (fix the file). max_passes and diff_cap may only lower a cap.',
  inputSchema: {
    type: 'object',
    properties: {
      step: { type: 'string', enum: ['open', 'after-code', 'after-review', 'close', 'status'] },
      slug: { type: 'string', description: 'work item, ^[a-z0-9][a-z0-9-]{0,63}$' },
      loop: { type: 'string', enum: ['code', 'plan'], description: 'default code; a plan loop takes no iteration, files, diff_cap or review settings' },
      iteration: { type: 'string', description: 'code loop: N.M, e.g. 3.1b' },
      files: { type: 'array', items: { type: 'string' }, description: 'open: relative paths the iteration may touch' },
      host: { type: 'string', enum: ['claude-code', 'copilot'] },
      max_passes: { type: 'integer', description: 'open: lower the pass cap' },
      diff_cap: { type: 'integer', description: 'open, after-code: lower the diff cap' },
      agent: { type: 'string', description: 'after-code: the agent that just ran' },
      review_mode: { type: 'string', enum: ['single', 'security', 'panel'], description: 'after-code: stronger lens only' },
      review_scope: { type: 'string', enum: ['delta', 'full'], description: 'after-code' },
      reviewers: { type: 'array', items: { type: 'string' }, description: 'after-review: review agents that ran' },
      verdict: { type: 'string', enum: ['approve', 'approve-with-comments', 'request-changes', 'reject'] },
      blockers: { type: 'integer', description: 'after-review: count of Blocker findings listed' },
      majors: { type: 'integer', description: 'after-review: count of Major findings listed' },
      findings: { type: 'array', items: { type: 'object' }, description: 'after-review: {file, title, severity, symbol?, confidence?}' },
      review: { type: 'string', description: 'after-review: review file name, no path' },
      fixed: { type: 'array', items: { type: 'string' }, description: 'after-review: finding ids really fixed, e.g. F-12' },
      status: { type: 'string', description: 'close: done, or stopped-<reason> from the last response' },
      project_dir: { type: 'string', description: 'absolute project path; narrows a host root, read-only status without one' },
    },
    required: ['step', 'slug'],
  },
};

const refuse = (step, code, error) => ({ text: JSON.stringify(base(typeof step === 'string' ? step.slice(0, 20) : null, { ok: false, exit: code, error: clean(error, 300) })), isError: true });

/**
 * @param {object} args the tool arguments
 * @param {{resolveRoot: (projectDirArg?: unknown) => Promise<{ok: boolean, root?: string, code?: number, message?: string, hosted?: boolean}>, env: object, installRoot: string}} deps
 * @returns {Promise<{text: string, isError: boolean}>}
 */
export async function callLoopStep(args, { resolveRoot, env, installRoot }) {
  const { project_dir: projectDir, ...stepArgs } = args;
  const { step } = stepArgs;
  if (typeof step !== 'string' || !Object.hasOwn(FIELDS, step)) return refuse(step, EXIT_USAGE, `step must be one of ${Object.keys(FIELDS).join(', ')}`);
  const write = step !== 'status';
  const found = await resolveRoot(projectDir);
  if (!found.ok && (found.hosted !== false || !write)) return refuse(step, found.code, found.message);
  if (write && found.hosted !== true) return refuse(step, EXIT_PROJECT_ENV, 'no host project root; run the loop through the CLI (node scripts/somi-loop.mjs step <name> ...)'); // fails closed on a result that does not say
  const stateDir = path.join(found.root, '.somi', 'somi-state', 'loop');
  const walked = write ? plainDir(found.root, ['.somi', 'somi-state', 'loop']) : {};
  if (walked.reason && walked.reason !== 'missing') return refuse(step, EXIT_USAGE, `.somi/somi-state/loop is ${walked.reason}`); // a link there would take the state file outside the project
  const ctx = {
    root: found.root, stateDir, installRoot, via: 'mcp',
    env: Object.fromEntries(PASSED_ENV.filter((k) => typeof env[k] === 'string').map((k) => [k, env[k]])),
    ...(found.hosted ? { log: stepLog(found.root, stateDir, false) } : {}), // a read through a model-supplied directory creates nothing there
  };
  const resp = runStep(ctx, stepArgs);
  return { text: JSON.stringify(resp), isError: resp.exit !== 0 && !GATE_STOPS.includes(resp.exit) };
}
