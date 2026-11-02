#!/usr/bin/env node
// somi: the canonical path into SoMi. Every state write happens inside these commands.
//
//   somi step open --title T [--ask QUESTION] [--follow-up AREA] [--release-candidate]
//   somi step after-code [--recheck]
//   somi step after-review [--input FILE]        reviews JSON on stdin by default
//   somi step decide --text T --then continue|close|abort
//   somi step close | status
//   somi check [--full]
//   somi finish                                  a worker ends its step: checks, signals, and a commit when nothing else is due
//   somi commit -m MESSAGE
//   somi slot <step> <plugin:component> [--mode read|write] [--project] | somi slot --list | --remove | --confirm
//   somi ledger --kind decision|constraint --text T
//   somi status | pr | migrate
//   somi plan                                    saves the plan text from stdin
//   somi doctor [--host claude|copilot] [--profile]
//   somi init --host copilot
//
// Exit codes: 0 done, 1 a check or the doctor failed, 64 the request was refused.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { checkBase, runCheck } from './lib/check.mjs';
import { ConfigFileError, loadConfig } from './lib/config-files.mjs';
import { runDoctor } from './lib/doctor.mjs';
import { finishWork } from './lib/engine.mjs';
import { commitAll, repoRoot, stateIsTracked } from './lib/git-tree.mjs';
import { writeCopilotHooks } from './lib/init.mjs';
import { StateError, readEvents } from './lib/journal.mjs';
import { TransitionError, afterCode, afterReview, close, decide, open, recordCheck, status } from './lib/kernel.mjs';
import { migrate } from './lib/migrate.mjs';
import { addToLedger } from './lib/ledger.mjs';
import { ReviewInputError } from './lib/policy.mjs';
import { ShardError, confirmProjectShards, listShards, slot, unslot } from './lib/shards.mjs';
import { detectHost } from './lib/tiers.mjs';
import { renderPr, renderStatus } from './lib/views.mjs';

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
  const result = runCheck({ root: ctx.root, env: ctx.env, full, from: checkBase(ctx.root, ctx.env) });
  recordCheck(ctx, { tree: result.tree, ok: result.ok, failed: result.failed, full });
  return result;
}

const MAX_PLAN_LINES = 200;
const MAX_PLAN_BYTES = 16384;

function savePlan(root, text) {
  if (text.split('\n').length > MAX_PLAN_LINES || Buffer.byteLength(text) > MAX_PLAN_BYTES) throw new StateError(`a plan is limited to ${MAX_PLAN_LINES} lines and ${MAX_PLAN_BYTES} bytes; state milestones and their proofs, not the design`);
  const dir = path.join(root, '.somi');
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new StateError('refusing to write through a link at .somi');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'plan.md');
  const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW = 0 } = fs.constants;
  const fd = fs.openSync(file, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0o644);
  try { fs.writeSync(fd, text); } finally { fs.closeSync(fd); }
  return path.relative(root, file);
}

function step(ctx, args) {
  const [action] = args;
  const flags = {
    open: { title: { type: 'string' }, ask: { type: 'string' }, 'follow-up': { type: 'string' }, 'release-candidate': { type: 'boolean' } },
    'after-code': { recheck: { type: 'boolean' } },
    'after-review': { input: { type: 'string' } },
    decide: { text: { type: 'string' }, then: { type: 'string' } },
    close: {},
    status: {},
  };
  if (!Object.hasOwn(flags, action)) throw new TransitionError('step takes open, after-code, after-review, decide, close or status');
  const { values } = parseArgs({ args: args.slice(1), options: flags[action] });
  switch (action) {
    case 'open':
      return print(open(ctx, { title: values.title, ask: values.ask, followUp: values['follow-up'], releaseCandidate: values['release-candidate'] }));
    case 'after-code': {
      let lastCheck = null;
      const response = afterCode(ctx, { recheck: values.recheck, runCheck: () => { lastCheck = checkAndRecord(ctx); } });
      if (lastCheck && !lastCheck.ok) response.check = { ok: false, gates: lastCheck.gates };
      return print(response);
    }
    case 'after-review': {
      const text = fs.readFileSync(values.input ?? 0, 'utf8');
      let reviews;
      try { reviews = JSON.parse(text); } catch { throw new ReviewInputError('the reviews are not valid JSON'); }
      return print(afterReview(ctx, { reviews }));
    }
    case 'decide':
      return print(decide(ctx, { text: values.text, then: values.then }));
    case 'close':
      return print(close(ctx));
    default:
      return print(status(ctx));
  }
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === 'doctor') {
    const { values } = parseArgs({ args, options: { host: { type: 'string' }, profile: { type: 'boolean' } } });
    const host = values.host === 'claude' || values.host === 'copilot' ? values.host : detectHost();
    if (values.profile) {
      process.stdout.write(fs.readFileSync(path.join(PLUGIN_ROOT, 'profiles', `${host}.json`), 'utf8'));
      return 0;
    }
    let root = process.cwd();
    try { root = repoRoot(root); } catch { /* the probes do not need a repository */ }
    let config = {};
    try { config = loadConfig(root).config ?? {}; } catch { /* a broken config is reported by the commands that need it */ }
    const report = runDoctor({ root, host, config });
    print(report);
    return report.ok ? 0 : 1;
  }
  const ctx = makeContext();
  switch (command) {
    case 'step':
      step(ctx, args);
      return 0;
    case 'check': {
      const { values } = parseArgs({ args, options: { full: { type: 'boolean' } } });
      const result = checkAndRecord(ctx, { full: values.full });
      print(result);
      return result.ok ? 0 : 1;
    }
    case 'finish': {
      const result = finishWork(ctx, { runChecks: () => checkAndRecord(ctx), commit: (title) => commitAll(ctx.root, title ?? 'SoMi work') });
      print(result);
      return result.ok ? 0 : 1;
    }
    case 'commit': {
      const { values } = parseArgs({ args, options: { message: { type: 'string', short: 'm' } } });
      print({ committed: commitAll(ctx.root, values.message ?? 'SoMi work') });
      return 0;
    }
    case 'status':
      process.stdout.write(renderStatus(readEvents(ctx.root, ctx.env)));
      return 0;
    case 'pr':
      process.stdout.write(renderPr(readEvents(ctx.root, ctx.env)));
      return 0;
    case 'plan':
      print({ saved: savePlan(ctx.root, fs.readFileSync(0, 'utf8')) });
      return 0;
    case 'slot': {
      const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { mode: { type: 'string' }, project: { type: 'boolean' }, list: { type: 'boolean' }, remove: { type: 'boolean' }, confirm: { type: 'boolean' } } });
      if (values.list) { print(listShards({ root: ctx.root, env: ctx.env }).map(({ step, ref, kind, mode, scope, state }) => ({ step, ref, kind, mode, scope, state }))); return 0; }
      if (values.confirm) { print(confirmProjectShards({ root: ctx.root, env: ctx.env })); return 0; }
      const [step, ref] = positionals;
      if (values.remove) { print(unslot({ root: ctx.root, step, ref, project: values.project, env: ctx.env })); return 0; }
      print(slot({ root: ctx.root, step, ref, mode: values.mode, project: values.project, env: ctx.env, now: ctx.now() }));
      return 0;
    }
    case 'ledger': {
      const { values } = parseArgs({ args, options: { kind: { type: 'string' }, text: { type: 'string' } } });
      print(addToLedger(ctx.root, { kind: values.kind, text: values.text }, ctx.env));
      return 0;
    }
    case 'migrate':
      print(migrate({ root: ctx.root, env: ctx.env, now: ctx.now }));
      return 0;
    case 'init': {
      const { values } = parseArgs({ args, options: { host: { type: 'string' } } });
      if (values.host !== 'copilot') throw new TransitionError('init takes --host copilot; the Claude Code plugin needs no setup');
      const result = writeCopilotHooks(ctx.root, PLUGIN_ROOT);
      print(result);
      return result.written ? 0 : 1;
    }
    default:
      throw new TransitionError('somi takes step, check, finish, commit, status, pr, plan, slot, ledger, migrate, doctor or init');
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  const refused = e instanceof TransitionError || e instanceof ReviewInputError || e instanceof StateError || e instanceof ShardError || e?.code?.startsWith?.('ERR_PARSE_ARGS');
  process.stderr.write(`somi: ${refused ? e.message : e.stack ?? e}\n`);
  process.exitCode = refused ? 64 : 70;
}
