#!/usr/bin/env node
// Drives scripts/somi-mcp.mjs over real stdio JSON-RPC for the somi_config tool: parity with the config
// CLI for every action, the host-root requirement for writes, argument rejection, and a broken config.
// Invoked from tests/scripts/somi-config.sh. CLAUDE_PROJECT_DIR is always set explicitly, so a run inside
// a Claude Code shell cannot change what a case means.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClient } from './somi-mcp-client.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SERVER = path.join(ROOT, 'scripts', 'somi-mcp.mjs');
const CFG_CLI = path.join(ROOT, 'scripts', 'somi-config.mjs');
let pass = 0; let fail = 0;
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
};
const tmpRoot = mkdtempSync(path.join(tmpdir(), 'somi-mcp-config-'));
const fresh = () => { const d = path.join(tmpRoot, `p${Math.random().toString(36).slice(2)}`); mkdirSync(d, { recursive: true }); return d; };
const projWith = (body) => { const d = fresh(); mkdirSync(path.join(d, '.somi')); writeFileSync(path.join(d, '.somi', 'config.json'), body); return d; };
async function withClient(root, fn, extraEnv = {}) {
  const client = new McpClient(SERVER, { env: { CLAUDE_PROJECT_DIR: root, ...extraEnv } });
  try { await client.initialize(); return await fn(client); } finally { client.close(); }
}
const call = (client, args) => client.request('tools/call', { name: 'somi_config', arguments: args });
const text = (r) => r?.content?.[0]?.text ?? '';
const exits = (r, code) => [r.isError, text(r).endsWith(`(exit ${code})`)];

console.log('== somi_config over MCP ==');

const viaMcp = fresh(); const viaCli = fresh();
await withClient(viaMcp, async (client) => {
  const steps = [['init'], ['show'], ['get', 'cost.ceiling'], ['set', 'cost.ceiling', 'low'], ['set', 'cost.agents.somi-designer', 'medium'], ['get', 'cost.agents.somi-designer'], ['unset', 'cost.agents.somi-designer'], ['show'], ['set', 'cost.bogus', 'low'], ['set', 'cost.ceiling', 'turbo']];
  for (const [action, ...kv] of steps) {
    let want; let code = 0;
    try { want = execFileSync(process.execPath, [CFG_CLI, action, ...kv, '--project-dir', viaCli], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SOMI_COST_CEILING: '' } }).trimEnd(); } catch (e) { code = e.status; }
    const r = await call(client, { action, key: kv[0], value: kv[1], project_dir: viaMcp });
    check(`${[action, ...kv].join(' ')}: ${code === 0 ? 'same JSON as the CLI' : `error with exit ${code}`}`, code === 0 ? [r.isError, text(r)] : exits(r, code), code === 0 ? [undefined, want] : [true, true]);
  }
  check('both projects hold the same bytes after the same steps', readFileSync(path.join(viaMcp, '.somi', 'config.json'), 'utf8'), readFileSync(path.join(viaCli, '.somi', 'config.json'), 'utf8'));
  for (const args of [{ action: 'drop' }, { action: 'get', key: '--project-dir' }, { action: 'set', key: 'cost.ceiling', value: 5 }, { action: 'get', key: 'cost.ceiling\u0000x' }, { action: 'set', key: 'cost.ceiling', value: 'low\nx' }]) {
    check(`rejects ${JSON.stringify(args)} with 64`, exits(await call(client, { ...args, project_dir: viaMcp }), 64), [true, true]);
  }
}, { CLAUDE_PLUGIN_ROOT: ROOT });
const bad = projWith('{ not json');
await withClient(bad, async (client) => {
  const r = await call(client, { action: 'set', key: 'cost.ceiling', value: 'low', project_dir: bad });
  check('an unparsable config: exit 67, file untouched', [...exits(r, 67), readFileSync(path.join(bad, '.somi', 'config.json'), 'utf8')], [true, true, '{ not json']);
});
// No host root: reads work from project_dir, writes are refused and nothing is created.
const lone = fresh();
await withClient('', async (client) => {
  for (const args of [{ action: 'set', key: 'cost.ceiling', value: 'low' }, { action: 'unset', key: 'cost.agents.somi-coder' }, { action: 'init' }]) {
    const r = await call(client, { ...args, project_dir: lone });
    check(`without a host root ${args.action} is refused (67)`, [...exits(r, 67), /no host project root/.test(text(r)), existsSync(path.join(lone, '.somi'))], [true, true, true, false]);
  }
  const r = await call(client, { action: 'show', project_dir: lone });
  check('without a host root show still works from project_dir', [r.isError, JSON.parse(text(r)).exists], [undefined, false]);
  const hp = fresh(); mkdirSync(path.join(hp, '.somi')); writeFileSync(path.join(hp, '.somi', 'config.json'), '{"cost":{"ceiling":"high"}}\n');
  const h = await call(client, { action: 'show', project_dir: hp, host: 'copilot' });
  check('show with host copilot passes --host through: the unmapped warning appears', [h.isError, JSON.parse(text(h)).warnings.some((w) => w.startsWith('copilot has no model mapping'))], [undefined, true]);
  const hs = await call(client, { action: 'set', key: 'cost.ceiling', value: 'high', project_dir: lone, host: 'copilot' });
  check('host on a non-show action is refused (64) before anything runs', exits(hs, 64), [true, true]);
});
// With a host root the CLI receives the real path of the root.
const hostReal = fresh(); const alias = path.join(fresh(), 'alias'); symlinkSync(hostReal, alias);
await withClient(alias, async (client) => {
  const r = await call(client, { action: 'init', project_dir: alias });
  check('a host root reached through a symlink is passed to the CLI by real path and works', [r.isError, existsSync(path.join(realpathSync(hostReal), '.somi', 'config.json'))], [undefined, true]);
});

// Lowering needs the user. With no CLAUDE_PLUGIN_ROOT (a heuristic for "no hook can ask") the tool refuses
// a lowering; with it set the hook asks instead, so the tool does not refuse.
for (const [label, env, lowersOk] of [['without CLAUDE_PLUGIN_ROOT', { CLAUDE_PLUGIN_ROOT: '' }, false], ['with CLAUDE_PLUGIN_ROOT set', { CLAUDE_PLUGIN_ROOT: ROOT, COPILOT_PLUGIN_ROOT: '' }, true], ['under Copilot CLI (COPILOT_PLUGIN_ROOT set too: its tool name escapes the hook matcher)', { CLAUDE_PLUGIN_ROOT: ROOT, COPILOT_PLUGIN_ROOT: ROOT }, false]]) {
  const p = fresh();
  await withClient(p, async (client) => {
    await call(client, { action: 'init', project_dir: p });
    const lower = await call(client, { action: 'set', key: 'cost.agents.somi-coder', value: 'low', project_dir: p });
    const onDisk = JSON.parse(readFileSync(path.join(p, '.somi', 'config.json'), 'utf8')).cost.agents;
    const raise = await call(client, { action: 'set', key: 'cost.agents.somi-coder', value: 'high', project_dir: p });
    const unsetPin = await call(client, { action: 'unset', key: 'cost.agents.somi-designer', project_dir: p });
    check(`${label}: a lowering set ${lowersOk ? 'goes through (the hook asks)' : 'is refused with 64 and the fixed message'}`, lowersOk ? [lower.isError, onDisk['somi-coder']] : [...exits(lower, 64), /this change lowers a tier and needs the user/.test(text(lower))], lowersOk ? [undefined, 'low'] : [true, true, true]);
    check(`${label}: a raise is not refused`, raise.isError, undefined);
    check(`${label}: an unset of a pin at the ceiling or above ${lowersOk ? 'goes through' : 'is judged by the same rule'}`, lowersOk ? unsetPin.isError : [unsetPin.isError, /lowers a tier/.test(text(unsetPin))], lowersOk ? undefined : [true, true]);
  }, env);
}

console.log(`somi_config MCP tests: ${pass} ok, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
