#!/usr/bin/env node
// somi: the command line behind SoMi's tools. Every state write happens inside these commands.
//
//   somi route <request> [--hint ROUTE] [--sensitive]   what a request should run as, at which tier
//   somi review [--always] [--security] [--base REF]    which reviewers a change needs
//   somi review --record [--input FILE] [--tree T]      records what reviewers returned, from stdin by default
//   somi check [--full]
//   somi pr [--base REF] [--unreviewed]                 writes the pull request text; a change that needed a review and has none is refused
//   somi plan | --done N | --close                      saves the plan text from stdin, marks a milestone done, or ends the plan
//   somi slot <step> <plugin:component> [--mode read|write] [--project] | somi slot --list | --remove | --confirm
//   somi ledger --kind decision|constraint|pointer --text T
//   somi status | migrate
//   somi setup [--host claude|copilot]                  makes SoMi the session agent, on the model set for its tier
//   somi doctor [--host claude|copilot] [--profile]
//   somi init --host copilot
//
// Exit codes: 0 done, 1 a check, the doctor or the pull request gate failed, 64 the request was refused.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { advise } from './lib/advisor.mjs';
import { runCheck } from './lib/check.mjs';
import { ConfigFileError, loadConfig } from './lib/config-files.mjs';
import { runDoctor } from './lib/doctor.mjs';
import { commitBase, listFiles, repoRoot, resolveRef, snapshotTree, stateIsTracked, workBase } from './lib/git-tree.mjs';
import { writeCopilotExtension, writeCopilotHooks } from './lib/init.mjs';
import { addToLedger, readLedger } from './lib/ledger.mjs';
import { migrate } from './lib/migrate.mjs';
import { lastCheck, migratedFindings, pullRequest } from './lib/pr.mjs';
import { closePlan, markMilestoneDone, planStatus, savePlan } from './lib/plan.mjs';
import { ReviewInputError } from './lib/policy.mjs';
import { SCOPES, limitsFor, resolveLimits } from './lib/quality/limits.mjs';
import { qualityGate } from './lib/quality/gate.mjs';
import { readReviews, recordReviews, reviewPlan } from './lib/reviews.mjs';
import { setupAgent } from './lib/setup.mjs';
import { ShardError, confirmProjectShards, listShards, slot, unslot } from './lib/shards.mjs';
import { StateError, statePaths, writeStateFile } from './lib/state.mjs';
import { detectHost } from './lib/tiers.mjs';
import { renderStatus } from './lib/views.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function makeContext(cwd = process.cwd(), env = process.env) {
  const root = repoRoot(cwd);
  if (!env.SOMI_STATE_DIR && stateIsTracked(root)) throw new StateError('.somi/state is committed to this repository, so SoMi will not trust it. Stop tracking it with `git rm -r --cached .somi/state`.');
  let layers = [];
  let config = {};
  try {
    const loaded = loadConfig(root, env);
    layers = [loaded.global.config, loaded.project.config];
    config = loaded.config;
  } catch (e) {
    if (!(e instanceof ConfigFileError)) throw e;
    process.stderr.write('somi: ignoring an unreadable config file; built-in signals still apply\n');
  }
  return { root, env, config, configLayers: layers, host: detectHost(env), now: () => env.SOMI_CLOCK || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

function checkAndRecord(ctx, { full = false } = {}) {
  const result = runCheck({ root: ctx.root, env: ctx.env, full });
  writeStateFile(ctx.root, statePaths(ctx.root, ctx.env).check, `${JSON.stringify({ at: ctx.now(), tree: result.tree, ok: result.ok, full })}\n`, ctx.env);
  return result;
}


function review(ctx, args) {
  const { values } = parseArgs({ args, options: { record: { type: 'boolean' }, input: { type: 'string' }, tree: { type: 'string' }, base: { type: 'string' }, always: { type: 'boolean' }, security: { type: 'boolean' } } });
  if (!values.record) return print(reviewPlan(ctx, values));
  let reviews;
  try { reviews = JSON.parse(fs.readFileSync(values.input ?? 0, 'utf8')); } catch { throw new ReviewInputError('the reviews are not valid JSON'); }
  return print(recordReviews(ctx, { reviews, base: values.base, tree: values.tree, always: values.always, security: values.security }));
}

function pr(ctx, args) {
  const { values } = parseArgs({ args, options: { base: { type: 'string' }, unreviewed: { type: 'boolean' } } });
  const result = pullRequest(ctx, { base: values.base, unreviewed: values.unreviewed });
  if (!result.ok) {
    process.stderr.write(`somi: ${result.why.replace('pass unreviewed', 'pass --unreviewed')}\n`);
    return 1;
  }
  process.stdout.write(result.text);
  return 0;
}

// The quality gate. --scope pr, the default, scores the work since this branch left the shared history, uncommitted files included, as
// the review check sees it. --scope commit scores what a commit adds to the last one. --benchmark scores with the default limits and
// counts an agent's own exemptions as violations.
async function quality(ctx, args) {
  const { values } = parseArgs({ args, options: { from: { type: 'string' }, scope: { type: 'string' }, benchmark: { type: 'boolean' } } });
  const scope = values.scope ?? 'pr';
  if (!SCOPES.includes(scope)) throw new StateError(`quality takes --scope ${SCOPES.join(' or ')}`);
  const from = values.from ? resolveRef(ctx.root, values.from) : scope === 'commit' ? commitBase(ctx.root) : workBase(ctx.root);
  const to = snapshotTree(ctx.root);
  const { limits, ignored } = values.benchmark ? { limits: limitsFor(scope), ignored: [] } : resolveLimits({ global: ctx.configLayers[0], project: ctx.configLayers[1], scope });
  const result = await qualityGate(ctx.root, { from, to, limits, now: ctx.now(), mode: values.benchmark ? 'benchmark' : 'project', repoFiles: listFiles(ctx.root, to) });
  print({ ...result, scope, from, to, ...(ignored.length ? { ignored_config: ignored } : {}) });
  return result.ok ? 0 : 1;
}

function plan(ctx, args) {
  const { values } = parseArgs({ args, options: { done: { type: 'string' }, close: { type: 'boolean' } } });
  if (values.close) return print(closePlan(ctx.root, ctx.env));
  if (values.done !== undefined) return print(markMilestoneDone(ctx.root, Number(values.done)));
  return print({ saved: savePlan(ctx.root, fs.readFileSync(0, 'utf8')), ...planStatus(ctx.root) });
}

// The probes do not need a repository, and a broken config is reported by the commands that need it.
function doctor(args) {
  const { values } = parseArgs({ args, options: { host: { type: 'string' }, profile: { type: 'boolean' } } });
  const host = values.host === 'claude' || values.host === 'copilot' ? values.host : detectHost();
  if (values.profile) {
    process.stdout.write(fs.readFileSync(path.join(PLUGIN_ROOT, 'profiles', `${host}.json`), 'utf8'));
    return 0;
  }
  let root = process.cwd();
  try { root = repoRoot(root); } catch { /* not in a repository */ }
  let config = {};
  try { config = loadConfig(root).config ?? {}; } catch { /* reported elsewhere */ }
  const report = runDoctor({ root, host, config });
  print(report);
  return report.ok ? 0 : 1;
}

function slotCommand(ctx, args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { mode: { type: 'string' }, project: { type: 'boolean' }, list: { type: 'boolean' }, remove: { type: 'boolean' }, confirm: { type: 'boolean' } } });
  const [step, ref] = positionals;
  if (values.list) print(listShards({ root: ctx.root, env: ctx.env }).map(({ step: s, ref: r, kind, mode, scope, state }) => ({ step: s, ref: r, kind, mode, scope, state })));
  else if (values.confirm) print(confirmProjectShards({ root: ctx.root, env: ctx.env }));
  else if (values.remove) print(unslot({ root: ctx.root, step, ref, project: values.project, env: ctx.env }));
  else print(slot({ root: ctx.root, step, ref, mode: values.mode, project: values.project, env: ctx.env, now: ctx.now() }));
  return 0;
}

function initCommand(ctx, args) {
  const { values } = parseArgs({ args, options: { host: { type: 'string' } } });
  if (values.host !== 'copilot') throw new StateError('init takes --host copilot; the Claude Code plugin needs no setup');
  const hooks = writeCopilotHooks(ctx.root, PLUGIN_ROOT);
  const extension = writeCopilotExtension(ctx.root, PLUGIN_ROOT);
  print({ hooks, extension, workflows: 'Copilot runs workflows in experimental mode: start it with --experimental, or turn it on with /experimental.' });
  return hooks.written && extension.written ? 0 : 1;
}

const printed = (value, ok = true) => { print(value); return ok ? 0 : 1; };

// Each command takes the project context and its own arguments, and returns the exit code.
const COMMANDS = {
  route: (ctx, args) => {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { hint: { type: 'string' }, sensitive: { type: 'boolean' } } });
    return printed(advise(ctx, { request: positionals.join(' '), hint: values.hint, sensitive: values.sensitive }));
  },
  review: (ctx, args) => { review(ctx, args); return 0; },
  quality,
  check: (ctx, args) => {
    const { values } = parseArgs({ args, options: { full: { type: 'boolean' } } });
    const result = checkAndRecord(ctx, { full: values.full });
    return printed(result, result.ok);
  },
  status: (ctx) => {
    process.stdout.write(renderStatus({ plan: planStatus(ctx.root), ledger: readLedger(ctx.root, ctx.env), reviews: readReviews(ctx.root, ctx.env), check: lastCheck(ctx.root, ctx.env), migrated: migratedFindings(ctx.root, ctx.env) }));
    return 0;
  },
  pr,
  plan: (ctx, args) => { plan(ctx, args); return 0; },
  setup: (ctx, args) => {
    const { values } = parseArgs({ args, options: { host: { type: 'string' } } });
    const result = setupAgent({ host: values.host === 'claude' || values.host === 'copilot' ? values.host : ctx.host, config: ctx.config, pluginRoot: PLUGIN_ROOT, env: ctx.env });
    return printed(result, result.written);
  },
  slot: slotCommand,
  ledger: (ctx, args) => {
    const { values } = parseArgs({ args, options: { kind: { type: 'string' }, text: { type: 'string' } } });
    return printed(addToLedger(ctx.root, { kind: values.kind, text: values.text }, ctx.env));
  },
  migrate: (ctx) => printed(migrate({ root: ctx.root, env: ctx.env, now: ctx.now })),
  init: initCommand,
};

function main(argv) {
  const [command, ...args] = argv;
  if (command === 'doctor') return doctor(args);
  const run = Object.hasOwn(COMMANDS, command ?? '') ? COMMANDS[command] : null;
  if (!run) throw new StateError('somi takes route, review, check, quality, status, pr, plan, setup, slot, ledger, migrate, doctor or init');
  return run(makeContext(), args);
}

function fail(e) {
  const refused = e instanceof ReviewInputError || e instanceof StateError || e instanceof ShardError || e?.code?.startsWith?.('ERR_PARSE_ARGS');
  process.stderr.write(`somi: ${refused ? e.message : e.stack ?? e}\n`);
  process.exitCode = refused ? 64 : 70;
}

// Every command answers at once except the quality gate, which waits on its parser.
try {
  const code = main(process.argv.slice(2));
  if (code instanceof Promise) code.then((c) => { process.exitCode = c; }, fail); else process.exitCode = code;
} catch (e) { fail(e); }
