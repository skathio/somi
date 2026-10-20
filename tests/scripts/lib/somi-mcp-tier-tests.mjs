#!/usr/bin/env node
// Drives scripts/somi-mcp.mjs over real stdio JSON-RPC for the somi_tier tool: the sizing CLI's own output and
// exit codes for every case, the advertised schema, and the hint for invented signal names. Invoked from
// tests/scripts/somi-mcp.sh next to the main MCP tests.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClient } from './somi-mcp-client.mjs';
import { SIGNAL_IDS } from '../../../scripts/lib/size-tier.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SERVER = path.join(ROOT, 'scripts', 'somi-mcp.mjs');
let pass = 0; let fail = 0;
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
};
async function withClient(env, fn) {
  const client = new McpClient(SERVER, { env });
  try { await client.initialize(); return await fn(client); } finally { client.close(); }
}
const toolCall = (client, name, args) => client.request('tools/call', { name, arguments: args });
const toolText = (r) => r?.content?.[0]?.text ?? '';

async function run() {
  console.log('== somi_tier (MCP) ==');
  // --- somi_tier: the sizing CLI's own output and exit codes, for every case --------------------
  await withClient({}, async (client) => {
    await client.initialize();
    const TIER_CLI = path.join(ROOT, 'scripts', 'somi-tier.mjs');
    const base = { T1: true, T2: true, T3: true, T4: true, T5: true, hard_surface: false, design_open: false, open_questions: 0, acceptance_testable: true, modules_touched: 1, est_files: 1, est_diff_lines: 40, existing_work_item: false, brief_exists: false };
    const sig = (over = {}) => Object.fromEntries(Object.entries({ ...base, ...over }).map(([k, v]) => [k, { value: v, evidence: 'e' }]));
    const cases = [
      ['trivial', sig(), undefined], ['small', sig({ T2: false, est_diff_lines: 80 }), undefined],
      ['floor', sig({ T3: false, hard_surface: true }), undefined], ['unknown signal', { ...sig(), T3: { value: null, evidence: 'x' } }, undefined],
      ['raise', sig(), 'full'], ['lower below the floor', sig({ T3: false }), 'small'],
    ];
    for (const [label, signals, override] of cases) {
      const argv = [TIER_CLI, 'resolve', '--signals', '-', ...(override ? ['--override', override] : [])];
      let want; let code = 0;
      try { want = execFileSync(process.execPath, argv, { input: JSON.stringify(signals), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trimEnd(); } catch (e) { code = e.status; want = null; }
      const r = await toolCall(client, 'somi_tier', { signals, ...(override ? { override } : {}) });
      if (code === 0) check(`somi_tier ${label}: same JSON as the CLI`, [r.isError, toolText(r)], [undefined, want]);
      else check(`somi_tier ${label}: error carries the CLI exit code`, [r.isError, toolText(r).endsWith(`(exit ${code})`)], [true, true]);
    }
    // The advertised schema lists the rubric's own ids (imported, not copied), each with value and evidence.
    const tierTool = ((await client.request('tools/list', {})).tools || []).find((t) => t.name === 'somi_tier');
    const sp = tierTool?.inputSchema?.properties?.signals;
    check('somi_tier schema: signals lists exactly the rubric signal ids, all required', [Object.keys(sp?.properties ?? {}), sp?.required], [[...SIGNAL_IDS], [...SIGNAL_IDS]]);
    check('somi_tier schema: every signal is an object that requires value and evidence', Object.values(sp?.properties ?? {}).every((v) => v.type === 'object' && JSON.stringify(v.required) === '["value","evidence"]'), true);
    check('somi_tier description says the ids are exact and points at the routing skill without stating a threshold', [/ids in `signals` are exact/.test(tierTool?.description ?? ''), /somi-routing/.test(sp?.description ?? ''), /\b(40|50)\b/.test(JSON.stringify(sp))], [true, true, false]);
    const invented = await toolCall(client, 'somi_tier', { signals: { business_logic_complexity: { value: true, evidence: 'SECRET-VALUE' }, 'x\u202ey': 1 } });
    const iv = JSON.parse(toolText(invented));
    check('somi_tier: invented names come back as unrecognized next to the expected ids; the decision is the closed one (full) and no value is echoed', [iv.tier, iv.unrecognized, iv.expected, toolText(invented).includes('SECRET-VALUE'), toolText(invented).includes('\u202e')], ['full', ['business_logic_complexity', 'x\u202ey'], [...SIGNAL_IDS], false, false]);
    check('somi_tier: a correct call carries neither unrecognized nor expected', ['unrecognized' in JSON.parse(toolText(await toolCall(client, 'somi_tier', { signals: sig() }))), 'expected' in JSON.parse(toolText(await toolCall(client, 'somi_tier', { signals: sig() })))], [false, false]);
    const noObj = await toolCall(client, 'somi_tier', { signals: [1] });
    check('somi_tier rejects non-object signals with 64 and writes nothing', [noObj.isError, /\(exit 64\)/.test(toolText(noObj)), existsSync(path.join(ROOT, '.somi', 'somi-state', 'tier', 'x.json'))], [true, true, false]);
  });

  console.log(`somi_tier tests: ${pass} ok, ${fail} failed`);
  if (fail) process.exitCode = 1;
}
run().catch((e) => { console.error(e); process.exit(1); });
