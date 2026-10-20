#!/usr/bin/env node
// L1 latency of the plugin's local machinery: every hook with a synthetic payload, the tier, config and dispatch
// CLIs, and one MCP round trip, each measured N times (default and minimum: the rule's L1 minRepeats).
//   node tests/scripts/manual/usage-l1.mjs [--runs N] [--json] [--only id,id]
// Prints a per-event table, or with --json an object shaped for a baseline: { runs, host, L1: { events }, summary }.
// Nothing here touches the repo's .somi/: every run is in a throwaway project dir with its own audit log.
// Exit 0 measured, 64 usage error or refused run count, 1 an event failed.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRule } from '../../evals/lib/bench-rule.mjs';
import { measureEvents, execRunner, toBaselineL1 } from '../../evals/lib/bench-l1.mjs';
import { hostFingerprint, collectHostInfo } from '../../evals/lib/bench-host.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NODE = process.execPath;
const at = (p) => join('{PLUGIN}', p);

const SIGNALS = Object.fromEntries(Object.entries({
  T1: true, T2: false, T3: true, T4: true, T5: true, hard_surface: false, design_open: false, open_questions: 0,
  acceptance_testable: true, modules_touched: 1, est_files: 1, est_diff_lines: 80, existing_work_item: false, brief_exists: false,
}).map(([k, v]) => [k, { value: v, evidence: 'e' }]));

const payload = (o) => JSON.stringify({ session_id: 'bench', cwd: '{PROJECT}', ...o });
const bash = (command) => payload({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
const write = (hook_event_name) => payload({
  hook_event_name, tool_name: 'Write', tool_input: { file_path: '{PROJECT}/notes.md', content: 'hello\n' },
});
const hook = (id, file, stdin) => ({ id: `hook.${id}`, command: [NODE, at(file)], stdin });

export const EVENTS = [
  hook('session-start.detect-repo-instructions', 'hooks/session-start/detect-repo-instructions.mjs', payload({ hook_event_name: 'SessionStart', source: 'startup' })),
  hook('session-start.ensure-default-config', 'hooks/session-start/ensure-default-config.mjs', payload({ hook_event_name: 'SessionStart', source: 'startup' })),
  hook('user-prompt-submit.inject-workflow-context', 'hooks/user-prompt-submit/inject-workflow-context.mjs', payload({ hook_event_name: 'UserPromptSubmit', prompt: 'plan a rate limiter for the webhook handler' })),
  hook('pre-tool.block-dangerous-bash', 'hooks/pre-tool/block-dangerous-bash.mjs', bash('ls -la')),
  hook('pre-tool.gate-dep-install', 'hooks/pre-tool/gate-dep-install.mjs', bash('ls -la')),
  hook('pre-tool.guard-cost-lowering', 'hooks/pre-tool/guard-cost-lowering.mjs', write('PreToolUse')),
  hook('pre-tool.block-secret-writes', 'hooks/pre-tool/block-secret-writes.mjs', write('PreToolUse')),
  hook('pre-tool.guard-protected-paths', 'hooks/pre-tool/guard-protected-paths.mjs', write('PreToolUse')),
  hook('post-tool.lint-changed-files', 'hooks/post-tool/lint-changed-files.mjs', write('PostToolUse')),
  hook('post-tool.audit-log', 'hooks/post-tool/audit-log.mjs', write('PostToolUse')),
  { id: 'cli.somi-tier-resolve', command: [NODE, at('scripts/somi-tier.mjs'), 'resolve', '--signals', '-'], stdin: JSON.stringify(SIGNALS) },
  { id: 'cli.somi-config-show', command: [NODE, at('scripts/somi-config.mjs'), 'show'] },
  { id: 'cli.somi-dispatch-resolve', command: [NODE, at('scripts/somi-dispatch.mjs'), 'resolve', '--agent', 'coder'] },
  { id: 'mcp.round-trip', mcp: true },
];

// One whole MCP conversation: spawn the server, initialize, tools/list, one somi_resolve call, close stdin, wait
// for exit. The measured time is the whole conversation, spawn included. Newline-delimited JSON-RPC.
function mcpRoundTrip(event, ctx) {
  return new Promise((resolve, reject) => {
    const env = {};
    for (const k of ['PATH', 'LANG', 'TZ', 'TMPDIR']) if (process.env[k]) env[k] = process.env[k];
    Object.assign(env, { HOME: ctx.project, CLAUDE_PROJECT_DIR: ctx.project, SOMI_AUDIT_LOG: join(ctx.project, 'audit.log'), CLAUDE_PLUGIN_ROOT: ctx.pluginRoot });
    const child = spawn(NODE, [join(ctx.pluginRoot, 'scripts', 'somi-mcp.mjs')], { cwd: ctx.project, env, stdio: ['pipe', 'pipe', 'ignore'] });
    const rpc = (id, method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const steps = [
      () => rpc(2, 'tools/list', {}),
      () => rpc(3, 'tools/call', { name: 'somi_resolve', arguments: { agent: 'coder' } }),
      () => child.stdin.end(),
    ];
    let buf = ''; let answered = 0;
    const fail = (msg) => { child.kill('SIGKILL'); reject(new Error(`event ${event.id}: ${msg}`)); };
    child.on('error', (e) => fail(e.message));
    child.stdin.on('error', () => {});
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { return fail('non-JSON line on stdout'); }
        if (msg.error || msg.id !== answered + 1) return fail(`unexpected reply ${line.slice(0, 80)}`);
        answered += 1;
        if (answered === 1) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
        steps[answered - 1]();
      }
    });
    child.on('close', (code) => (code === 0 && answered === 3 ? resolve() : fail(`exit ${code} after ${answered} replies`)));
    rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'usage-l1', version: '1' } });
  });
}

const runner = (event, ctx) => (event.mcp ? mcpRoundTrip(event, ctx) : execRunner(event, ctx));

function parse(argv) {
  const o = { json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') o.json = true;
    else if (argv[i] === '--runs') o.runs = Number(argv[++i]);
    else if (argv[i] === '--only') o.only = String(argv[++i]).split(',');
    else return null;
  }
  return o;
}

const pad = (s, n) => String(s).padEnd(n);
const ms = (x) => x.toFixed(2).padStart(9);

async function main() {
  const opts = parse(process.argv.slice(2));
  if (!opts) { console.error('usage: usage-l1.mjs [--runs N] [--json] [--only id,id]'); return 64; }
  const rule = loadRule();
  if (!rule) { console.error('usage-l1: the benchmark rule file is missing or invalid'); return 64; }
  const events = opts.only ? EVENTS.filter((e) => opts.only.includes(e.id)) : EVENTS;
  if (events.length === 0) { console.error('usage-l1: --only matched no event'); return 64; }
  let results;
  try {
    results = await measureEvents({ events, rule, runs: opts.runs, runner, pluginRoot: ROOT });
  } catch (e) {
    console.error(`usage-l1: ${e.message}`);
    return e instanceof RangeError ? 64 : 1;
  }
  const pluginVersion = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const host = hostFingerprint(collectHostInfo(pluginVersion));
  const runs = Object.values(results)[0].samples.length;
  if (opts.json) {
    const summary = Object.fromEntries(Object.entries(results).map(([id, { median, p90, min, max }]) => [id, { median, p90, min, max }]));
    console.log(JSON.stringify({ runs, host, L1: toBaselineL1(results), summary }, null, 2));
    return 0;
  }
  console.log(`L1 latency, ${runs} runs per event after one discarded warm-up (ms)`);
  console.log(`host: ${host.cpuModel}, ${host.cores} cores, ${host.memGb} GB, ${host.osRelease}, node ${host.nodeVersion}`);
  console.log(`${pad('event', 46)}${'median'.padStart(9)}${'p90'.padStart(9)}${'min'.padStart(9)}${'max'.padStart(9)}${'spread'.padStart(9)}`);
  for (const [id, r] of Object.entries(results)) console.log(`${pad(id, 46)}${ms(r.median)}${ms(r.p90)}${ms(r.min)}${ms(r.max)}${ms(r.max - r.min)}`);
  return 0;
}

process.exitCode = await main();
