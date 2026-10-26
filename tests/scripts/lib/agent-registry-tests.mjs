#!/usr/bin/env node
// Agent registry (scripts/lib/agent-registry.mjs) and the read-only somi_agent_info MCP tool:
// parity with agents/*.md, alias normalisation, collision validation, unknown and invalid identifiers,
// agreement with somi_resolve, and that a lookup never writes project state.

import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClient } from './somi-mcp-client.mjs';
import { buildRegistry, normalize, catalog, RegistryError, HOST_REGISTRATIONS } from '../../../scripts/lib/agent-registry.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SERVER = path.join(ROOT, 'scripts', 'somi-mcp.mjs');
let pass = 0; let fail = 0;
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
};
const tmpRoot = mkdtempSync(path.join(tmpdir(), 'somi-agent-info-'));
const fresh = (cfg) => {
  const d = path.join(tmpRoot, `p${Math.random().toString(36).slice(2)}`); mkdirSync(d, { recursive: true });
  if (cfg !== undefined) { mkdirSync(path.join(d, '.somi')); writeFileSync(path.join(d, '.somi', 'config.json'), cfg); }
  return d;
};

console.log('== agent registry ==');
const reg = buildRegistry();
const stems = readdirSync(path.join(ROOT, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
check('canonical names equal agents/*.md (specialists from the tier table + the somi front door)', [...reg.canonical].sort(), stems);
check('every agent has exactly the one alias both hosts register: somi:<canonical>', stems.every((n) => JSON.stringify(reg.aliasesOf.get(n)) === JSON.stringify([`somi:${n}`])), true);
check('both shipped hosts are registered, and only they', Object.keys(HOST_REGISTRATIONS).sort(), ['claude-code', 'copilot']);
check('canonical name -> itself, no matched alias', normalize(reg, 'somi-coder'), { ok: true, canonical: 'somi-coder', matched_alias: null });
check('registered alias -> the same canonical agent', normalize(reg, 'somi:somi-coder'), { ok: true, canonical: 'somi-coder', matched_alias: 'somi:somi-coder' });
check('every alias resolves to the canonical agent it was registered for', stems.every((n) => reg.aliasesOf.get(n).every((a) => normalize(reg, a).canonical === n)), true);
check('a pre-4.0.0 bare name is unknown, with a derived hint (not an alias)', normalize(reg, 'coder'), { ok: false, reason: 'unknown', message: 'unknown agent "coder" (renamed in 4.0.0: use "somi-coder")' });
check('an alias no host registers is unknown, never routed elsewhere', normalize(reg, 'somi:coder').reason, 'unknown');
check('an unrelated name is unknown without a hint', normalize(reg, 'general-purpose').message, 'unknown agent "general-purpose"');
for (const bad of ['../agents/somi-coder', 'agents/somi-coder.md', 'Somi-Coder', 'a:b:c', '', 'x'.repeat(65), 42, null]) {
  check(`invalid identifier ${JSON.stringify(bad)} is refused before any lookup`, normalize(reg, bad).reason, 'invalid');
}
const throwsRegistry = (fn) => { try { fn(); return false; } catch (e) { return e instanceof RegistryError; } };
check('a host alias mapping two agents to one id fails validation', throwsRegistry(() => buildRegistry({ 'somi-a': 'low', 'somi-b': 'low' }, { h: () => 'same' })), true);
check('an alias that shadows a canonical name fails validation', throwsRegistry(() => buildRegistry({ 'somi-a': 'low', 'somi-b': 'low' }, { h: (n) => (n === 'somi-a' ? 'somi-b' : `x:${n}`) })), true);
check('the catalog lists every agent once, the front door last, with its role', catalog(reg).map((e) => `${e.canonical_name}/${e.role}`).slice(-1), ['somi/orchestrator']);

console.log('== somi_agent_info over MCP ==');
async function withClient(root, fn, env = {}) {
  const client = new McpClient(SERVER, { env: { CLAUDE_PROJECT_DIR: root, SOMI_COST_CEILING: '', ...env } });
  try { await client.initialize(); return await fn(client); } finally { client.close(); }
}
const info = (c, args) => c.request('tools/call', { name: 'somi_agent_info', arguments: args });
const resolve = (c, args) => c.request('tools/call', { name: 'somi_resolve', arguments: args });
const text = (r) => r?.content?.[0]?.text ?? '';
const json = (r) => JSON.parse(text(r));
const exitOf = (r) => [r.isError, /\(exit (\d+)\)$/.exec(text(r))?.[1]];

const p = fresh('{"cost":{"ceiling":"low","agents":{"somi-security-reviewer":"high"},"mapping":{"copilot":{"low":"m-low","medium":"m-mid","high":"m-high"}}}}\n');
await withClient(p, async (c) => {
  const cat = json(await info(c, {}));
  check('catalog: canonical names only, in the registry order', cat.agents.map((e) => e.canonical_name), [...stems.filter((s) => s !== 'somi'), 'somi']);
  check('catalog: only registered aliases', cat.agents.every((e) => JSON.stringify(e.aliases) === JSON.stringify([`somi:${e.canonical_name}`])), true);
  for (const host of ['claude-code', 'copilot']) {
    const byName = json(await info(c, { agent: 'somi-coder', host, project_dir: p }));
    const byAlias = json(await info(c, { agent: 'somi:somi-coder', host, project_dir: p }));
    const res = json(await resolve(c, { agent: 'somi-coder', host, project_dir: p }));
    check(`${host}: lookup by name and by alias resolve to the same agent and dispatch`, [byAlias.canonical_name, byAlias.dispatch_tier, byAlias.model], [byName.canonical_name, byName.dispatch_tier, byName.model]);
    check(`${host}: the alias lookup names the alias it matched; the name lookup reports none`, [byAlias.matched_alias, byName.matched_alias, byAlias.aliases, byName.aliases], ['somi:somi-coder', null, [], ['somi:somi-coder']]);
    check(`${host}: tier, model, enforcement and ceiling match somi_resolve exactly`,
      [byName.dispatch_tier, byName.model, byName.enforced, byName.session_ceiling.value, byName.agent_type],
      [res.tier, res.model, res.enforced, res.ceiling, res.agent_type]);
  }
  const sec = json(await info(c, { agent: 'somi:somi-security-reviewer', host: 'copilot', project_dir: p }));
  check('declared default vs effective tier are distinct fields (pinned above a low ceiling)', [sec.default_tier, sec.dispatch_tier, sec.tier_source, sec.model], ['high', 'high', 'override', 'm-high']);
  check('an unknown alias is a 65 naming it, never a dispatch', exitOf(await info(c, { agent: 'somi:general-purpose', project_dir: p })), [true, '65']);
  check('a pre-4.0.0 name is a 65 with the rename hint', /renamed in 4\.0\.0: use "somi-reviewer"/.test(text(await info(c, { agent: 'reviewer', project_dir: p }))), true);
  check('a traversal identifier is a 64', exitOf(await info(c, { agent: '../agents/somi-coder', project_dir: p })), [true, '64']);
  check('a bad host is a 64', exitOf(await info(c, { agent: 'somi-coder', host: 'Co Pilot', project_dir: p })), [true, '64']);
  const front = json(await info(c, { agent: 'somi:somi', host: 'copilot' }));
  check('the front door is identified, never dispatched', [front.canonical_name, front.role, front.dispatch], ['somi', 'orchestrator', null]);
});
const broken = fresh('{ not json');
await withClient(broken, async (c) => {
  check('a resolver failure (corrupt config) is the resolver\'s own 67', exitOf(await info(c, { agent: 'somi-coder', project_dir: broken })), [true, '67']);
});
const ro = fresh();
await withClient(ro, async (c) => {
  const r = json(await info(c, { agent: 'somi-coder', project_dir: ro }));
  check('an env ceiling is reported...', [r.session_ceiling.value, r.session_ceiling.source], ['high', 'env']);
  check('...but a lookup never persists it (no .somi/somi-state written)', existsSync(path.join(ro, '.somi')), false);
  await resolve(c, { agent: 'somi-coder', project_dir: ro });
  check('control: somi_resolve with the same env ceiling does persist it', existsSync(path.join(ro, '.somi', 'somi-state', 'ceiling.json')), true);
}, { SOMI_COST_CEILING: 'high' });

console.log(`agent registry tests: ${pass} ok, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
